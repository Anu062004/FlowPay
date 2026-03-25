import { db } from "../db/pool.js";
import type { AgentLogContext, AgentPolicyResult } from "./agentLogService.js";
import { logAgentAction } from "./agentLogService.js";
import {
  analyzeInvestmentAllocation,
  checkTradingAgentsHealth,
  type TradingAgentsAllocationAction,
  type TradingAgentsAllocationItem,
  type TradingAgentsDecision
} from "../clients/tradingAgentsClient.js";
import {
  closeActiveInvestmentPositions,
  executeInvestmentDecision,
  getCurrentInvestmentAllocation
} from "./investmentExecutionService.js";
import { evaluateAgentPolicy } from "./agentPolicyService.js";
import { getCompanySettlementChain } from "./companySettlementService.js";
import { getSettlementCurrencyLabel, getSettlementNetworkLabel } from "../utils/settlement.js";
import {
  canonicalizeInvestmentProtocolKey,
  getEnabledInvestmentProtocols as getConfiguredInvestmentProtocols,
  getExecutableProtocolsForChain,
  getExecutionAssetForChain,
  getTradingAgentsConfig,
  getTreasuryAssetForChain
} from "./investmentNetworkConfig.js";

type AggregatedPolicyResult = AgentPolicyResult & {
  itemResults: Array<{
    protocolKey: string;
    status: AgentPolicyResult["status"];
    reasons: string[];
    amount: number;
    percent: number;
  }>;
};

type LatestInvestmentDecision = {
  timestamp: string;
  action: string | null;
  confidence: number | null;
  model_used: string | null;
  reasoning: string;
  execution_status: string | null;
  allocation: Array<{
    protocolKey: string;
    protocol: string;
    action: TradingAgentsAllocationAction | null;
    percent: number;
    amount_usdc: number;
  }>;
};

function parseFloatSafe(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? parseFloat(value)
        : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseLoggedAllocation(
  allocation: unknown
): LatestInvestmentDecision["allocation"] {
  if (!allocation || typeof allocation !== "object") {
    return [];
  }

  return Object.entries(allocation as Record<string, Record<string, unknown>>)
    .map(([protocolKey, item]) => {
      const normalizedProtocolKey = canonicalizeInvestmentProtocolKey(protocolKey);
      const action: TradingAgentsAllocationAction | null =
        item.action === "deposit" || item.action === "swap_to_pt" || item.action === "supply"
          ? item.action
          : null;

      return {
        protocolKey: normalizedProtocolKey,
        protocol: typeof item.protocol === "string" ? item.protocol : normalizedProtocolKey,
        action,
        percent: parseFloatSafe(item.percent),
        amount_usdc: parseFloatSafe(item.amount_usdc)
      };
    })
    .filter((item) => item.percent > 0 || item.amount_usdc > 0);
}

function round(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return parseFloat(value.toFixed(6));
}

export function getEnabledInvestmentProtocols() {
  return Array.from(getConfiguredInvestmentProtocols());
}

function ensureStableTreasuryConfig(chain: Awaited<ReturnType<typeof getCompanySettlementChain>>) {
  const treasuryAsset = getTreasuryAssetForChain(chain);
  const executionAsset = getExecutionAssetForChain(chain);
  if (!treasuryAsset.address) {
    throw new Error(`Treasury token must be configured for ${getSettlementNetworkLabel(chain)}`);
  }
  if (!executionAsset.address) {
    throw new Error(
      `Investment execution token must be configured for ${getSettlementNetworkLabel(chain)}`
    );
  }
}

export function getExecutableInvestmentProtocols(chain: Awaited<ReturnType<typeof getCompanySettlementChain>>) {
  return Array.from(getExecutableProtocolsForChain(chain));
}

async function getInvestmentSupportState(companyId: string) {
  const chain = await getCompanySettlementChain(companyId);
  const tradingAgentsConfig = getTradingAgentsConfig(chain);
  const executableProtocols = getExecutableInvestmentProtocols(chain);

  if (!tradingAgentsConfig) {
    return {
      chain,
      supported: false,
      reason: `TradingAgents is not configured for ${getSettlementNetworkLabel(chain)} yet. Add ${chain.toUpperCase()}_TRADING_AGENTS_URL and ${chain.toUpperCase()}_TRADING_AGENTS_SECRET on the backend.`
    };
  }

  if (executableProtocols.length === 0) {
    return {
      chain,
      supported: false,
      reason: `Investment execution is not configured for ${getSettlementCurrencyLabel(chain)} yet. Add ${chain.toUpperCase()} investment protocol addresses before running TradingAgents automation.`
    };
  }

  return {
    chain,
    supported: true,
    reason: null
  };
}

export async function getTradingAgentsOverview(companyId: string) {
  const investmentSupport = await getInvestmentSupportState(companyId);
  const tradingAgentsConfig = getTradingAgentsConfig(investmentSupport.chain);
  const configured = Boolean(tradingAgentsConfig);
  let reachable = false;
  let health: Record<string, unknown> | null = null;
  let healthError: string | null = investmentSupport.reason;

  if (configured && investmentSupport.supported) {
    try {
      health = await checkTradingAgentsHealth(tradingAgentsConfig);
      reachable = true;
    } catch (error) {
      healthError = error instanceof Error ? error.message : "TradingAgents health check failed";
    }
  }

  const result = await db.query(
    `SELECT timestamp, decision, rationale, execution_status
     FROM agent_logs
     WHERE company_id = $1
       AND agent_name = 'TradingAgentsDecisionEngine'
     ORDER BY timestamp DESC
     LIMIT 1`,
    [companyId]
  );

  const row = result.rows[0] ?? null;
  const latestDecision: LatestInvestmentDecision | null = row
    ? {
        timestamp: row.timestamp,
        action: typeof row.decision?.action === "string" ? row.decision.action : null,
        confidence:
          typeof row.decision?.confidence === "number"
            ? row.decision.confidence
            : typeof row.decision?.confidence === "string"
              ? parseFloatSafe(row.decision.confidence)
              : null,
        model_used: typeof row.decision?.model_used === "string" ? row.decision.model_used : null,
        reasoning: typeof row.rationale === "string" ? row.rationale : "",
        execution_status: typeof row.execution_status === "string" ? row.execution_status : null,
        allocation: parseLoggedAllocation(row.decision?.allocation)
      }
    : null;

  return {
    configured,
    reachable,
    url: tradingAgentsConfig?.url ?? null,
    timeout_ms: tradingAgentsConfig?.timeoutMs ?? 300000,
    enabled_protocols: getEnabledInvestmentProtocols(),
    executable_protocols: getExecutableInvestmentProtocols(investmentSupport.chain),
    health,
    healthError,
    latestDecision
  };
}

function buildFallbackAllocation(
  totalAmount: number,
  chain: Awaited<ReturnType<typeof getCompanySettlementChain>>
): Record<string, TradingAgentsAllocationItem> {
  const executable = getExecutableProtocolsForChain(chain);

  if (executable.has("aave_usdc") && executable.has("yearn_usdc")) {
    const yearnAmount = round(totalAmount * 0.6);
    const aaveAmount = round(totalAmount - yearnAmount);
    return {
      yearn_usdc: {
        protocol: "yearn-v3",
        action: "deposit" as const,
        percent: 0.6,
        amount_usdc: yearnAmount
      },
      aave_usdc: {
        protocol: "aave-v3",
        action: "supply" as const,
        percent: 0.4,
        amount_usdc: aaveAmount
      }
    };
  }

  if (executable.has("aave_usdc")) {
    const allocation: Record<string, TradingAgentsAllocationItem> = {};
    allocation.aave_usdc = {
      protocol: "aave-v3",
      action: "supply",
      percent: 1,
      amount_usdc: round(totalAmount)
    };
    return allocation;
  }

  if (executable.has("yearn_usdc")) {
    const allocation: Record<string, TradingAgentsAllocationItem> = {};
    allocation.yearn_usdc = {
      protocol: "yearn-v3",
      action: "deposit",
      percent: 1,
      amount_usdc: round(totalAmount)
    };
    return allocation;
  }

  if (executable.has("morpho_v1_usdc")) {
    const allocation: Record<string, TradingAgentsAllocationItem> = {};
    allocation.morpho_v1_usdc = {
      protocol: "morpho-v1",
      action: "deposit",
      percent: 1,
      amount_usdc: round(totalAmount)
    };
    return allocation;
  }

  if (executable.has("compound_v3_usdc")) {
    const allocation: Record<string, TradingAgentsAllocationItem> = {};
    allocation.compound_v3_usdc = {
      protocol: "compound-v3",
      action: "deposit",
      percent: 1,
      amount_usdc: round(totalAmount)
    };
    return allocation;
  }

  throw new Error(
    "No executable investment protocols are enabled. Configure INVESTMENT_ENABLED_PROTOCOLS and protocol addresses before running TradingAgents automation."
  );
}

function normalizeAutomatedAllocation(
  decision: TradingAgentsDecision,
  chain: Awaited<ReturnType<typeof getCompanySettlementChain>>
): TradingAgentsDecision {
  if (decision.action === "HOLD" || decision.action === "WITHDRAW") {
    return decision;
  }

  const entries = Object.entries(decision.allocation ?? {}).map(([protocolKey, item]) => [
    canonicalizeInvestmentProtocolKey(protocolKey),
    item
  ] as const);
  if (entries.length === 0) {
    return decision;
  }

  const executable = getExecutableProtocolsForChain(chain);
  const supported = entries.filter(([protocolKey]) => executable.has(protocolKey));
  const unsupported = entries.filter(([protocolKey]) => !executable.has(protocolKey));
  if (unsupported.length === 0) {
    return decision;
  }

  const totalAmount = entries.reduce((sum, [, item]) => sum + item.amount_usdc, 0);
  const note =
    `FlowPay normalized unsupported or disabled protocols (${unsupported.map(([protocolKey]) => protocolKey).join(", ")}) ` +
    `out of the executable plan because only configured executable protocols are allowed in this build.`;

  if (supported.length === 0) {
    return {
      ...decision,
      allocation: buildFallbackAllocation(totalAmount, chain),
      confidence: Math.max(0.5, round(decision.confidence - 0.05)),
      reasoning: `${decision.reasoning}\n\n${note}`
    };
  }

  const supportedTotal = supported.reduce((sum, [, item]) => sum + item.amount_usdc, 0);
  const normalizedAllocation = Object.fromEntries(
    supported.map(([protocolKey, item]) => {
      const share = supportedTotal > 0 ? item.amount_usdc / supportedTotal : 0;
      const amount = round(totalAmount * share);
      return [
        protocolKey,
        {
          ...item,
          amount_usdc: amount,
          percent: totalAmount > 0 ? round(amount / totalAmount) : 0
        }
      ];
    })
  );

  return {
    ...decision,
    allocation: normalizedAllocation,
    confidence: Math.max(0.5, round(decision.confidence - 0.05)),
    reasoning: `${decision.reasoning}\n\n${note}`
  };
}

async function getInvestmentPool(companyId: string) {
  const result = await db.query(
    `SELECT investment_pool, payroll_reserve, lending_pool, main_reserve
     FROM treasury_allocations
     WHERE company_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [companyId]
  );

  const row = result.rows[0] ?? null;
  return {
    investmentPool: parseFloat(row?.investment_pool ?? "0"),
    payrollReserve: parseFloat(row?.payroll_reserve ?? "0"),
    lendingPool: parseFloat(row?.lending_pool ?? "0"),
    mainReserve: parseFloat(row?.main_reserve ?? "0")
  };
}

async function evaluateInvestmentDecisionPolicy(
  companyId: string,
  decision: TradingAgentsDecision
): Promise<AggregatedPolicyResult> {
  const itemResults = [];
  const combinedChecks: Array<Record<string, unknown>> = [];
  const combinedReasons = new Set<string>();
  let finalStatus: AgentPolicyResult["status"] = "allow";

  for (const [protocolKey, allocation] of Object.entries(decision.allocation)) {
    const result = await evaluateAgentPolicy({
      companyId,
      action: "investment_rebalance",
      amount: allocation.amount_usdc,
      metadata: {
        allocationPct: allocation.percent * 100
      }
    });

    itemResults.push({
      protocolKey,
      status: result.status,
      reasons: result.reasons,
      amount: allocation.amount_usdc,
      percent: allocation.percent
    });
    combinedChecks.push({
      protocolKey,
      amount: round(allocation.amount_usdc),
      percent: round(allocation.percent * 100),
      result
    });
    result.reasons.forEach((reason) => combinedReasons.add(reason));

    if (result.status === "block") {
      finalStatus = "block";
    } else if (result.status === "review" && finalStatus !== "block") {
      finalStatus = "review";
    }
  }

  const totalAmount = Object.values(decision.allocation).reduce((sum, item) => sum + item.amount_usdc, 0);
  const maxPercent = Object.values(decision.allocation).reduce((max, item) => Math.max(max, item.percent * 100), 0);

  return {
    status: finalStatus,
    reasons: Array.from(combinedReasons),
    checks: combinedChecks,
    amount: round(totalAmount),
    limits: {
      maxAllocationPct: round(maxPercent)
    },
    metrics: {
      allocationCount: Object.keys(decision.allocation).length
    },
    itemResults
  };
}

function summarizeDecision(decision: TradingAgentsDecision) {
  return {
    action: decision.action,
    confidence: decision.confidence,
    model_used: decision.model_used,
    allocation: decision.allocation,
    reasoning: decision.reasoning.slice(0, 500),
    defi_snapshot: decision.defi_snapshot.slice(0, 500)
  };
}

export async function runInvestment(companyId: string, auditContext: AgentLogContext = {}) {
  const investmentSupport = await getInvestmentSupportState(companyId);
  if (!investmentSupport.supported) {
    throw new Error(investmentSupport.reason ?? "Investment automation is not configured for this settlement network");
  }

  ensureStableTreasuryConfig(investmentSupport.chain);
  const tradingAgentsConfig = getTradingAgentsConfig(investmentSupport.chain);
  const treasuryTokenSymbol = getTreasuryAssetForChain(investmentSupport.chain).symbol;

  const { investmentPool, payrollReserve, lendingPool, mainReserve } = await getInvestmentPool(companyId);
  const currentAllocation = await getCurrentInvestmentAllocation(companyId);

  if (investmentPool < 10) {
    await logAgentAction(
      "TradingAgentsDecisionEngine",
      {
        companyId,
        investmentPool,
        currentAllocation
      },
      { action: "HOLD" },
      "Investment pool is below the minimum threshold for TradingAgents analysis.",
      `Skipped investment analysis because the investment pool is under 10 ${treasuryTokenSymbol}.`,
      companyId,
      {
        ...auditContext,
        stage: "decision",
        executionStatus: "skipped"
      }
    );

    return {
      action: "HOLD" as const,
      allocation: {},
      confidence: 0,
      reasoning: "Investment pool below minimum threshold.",
      invested_amount: 0,
      txHashes: [],
      current_allocation: currentAllocation
    };
  }

  await checkTradingAgentsHealth(tradingAgentsConfig);
  const rawDecision = await analyzeInvestmentAllocation({
    capitalUsdc: investmentPool,
    horizon: "30d",
    currentAllocation
  }, tradingAgentsConfig);
  const decision = normalizeAutomatedAllocation(rawDecision, investmentSupport.chain);

  await logAgentAction(
    "TradingAgentsDecisionEngine",
    {
      companyId,
      investmentPool,
      payrollReserve,
      lendingPool,
      mainReserve,
      currentAllocation
    },
    summarizeDecision(decision),
    decision.reasoning,
    `TradingAgents returned ${decision.action} at ${(decision.confidence * 100).toFixed(1)}% confidence.`,
    companyId,
    {
      ...auditContext,
      stage: "decision",
      metadata: {
        modelUsed: decision.model_used
      }
    }
  );

  if (decision.action === "HOLD") {
    return {
      ...decision,
      invested_amount: 0,
      txHashes: [],
      current_allocation: currentAllocation
    };
  }

  const policyResult = await evaluateInvestmentDecisionPolicy(companyId, decision);
  await logAgentAction(
    "FlowPayPolicyEngine",
    {
      companyId,
      action: decision.action,
      allocation: decision.allocation
    },
    {
      action: "investment_rebalance",
      result: policyResult.status
    },
    policyResult.reasons.join(" ") || "Investment allocation passed policy checks.",
    `Investment policy status: ${policyResult.status.toUpperCase()}`,
    companyId,
    {
      ...auditContext,
      stage: "policy_validation",
      policyResult,
      executionStatus: policyResult.status
    }
  );

  if (policyResult.status !== "allow") {
    return {
      ...decision,
      invested_amount: 0,
      txHashes: [],
      policy: policyResult,
      current_allocation: currentAllocation
    };
  }

  const txHashes: string[] = [];
  const closedPositions =
    decision.action === "REBALANCE" || decision.action === "WITHDRAW"
      ? await closeActiveInvestmentPositions(companyId)
      : [];

  for (const closed of closedPositions) {
    txHashes.push(closed.txHash);
    await logAgentAction(
      "WDKExecutionLayer",
      {
        companyId,
        protocol: closed.protocolKey,
        amount: closed.amount,
        txHash: closed.txHash
      },
      {
        action: "withdraw"
      },
      "Closed active protocol position before applying the new TradingAgents posture.",
      `Closed ${closed.protocolKey} position for ${closed.amount.toFixed(6)} ${closed.assetSymbol}.`,
      companyId,
      {
        ...auditContext,
        stage: "wdk_execution",
        executionStatus: "success",
        metadata: {
          protocol: closed.protocolKey,
          txHash: closed.txHash
        }
      }
    );
  }

  if (decision.action === "WITHDRAW") {
    return {
      ...decision,
      invested_amount: 0,
      txHashes,
      policy: policyResult,
      closed_positions: closedPositions,
      current_allocation: currentAllocation
    };
  }

  const executed = await executeInvestmentDecision(companyId, decision);
  for (const item of executed) {
    txHashes.push(item.txHash);
    await logAgentAction(
      "WDKExecutionLayer",
      {
        companyId,
        protocol: item.protocolKey,
        action: item.action,
        amount: item.amount,
        txHash: item.txHash
      },
      {
        action: item.action,
        protocol: item.protocol
      },
      "Executed TradingAgents allocation against the company treasury wallet.",
      `Executed ${item.action} on ${item.protocolKey} for ${item.amount.toFixed(6)} ${item.assetSymbol}.`,
      companyId,
      {
        ...auditContext,
        stage: "wdk_execution",
        executionStatus: "success",
        metadata: {
          protocol: item.protocolKey,
          txHash: item.txHash
        }
      }
    );
  }

  const investedAmount = executed.reduce((sum, item) => sum + item.amount, 0);
  return {
    ...decision,
    invested_amount: round(investedAmount),
    txHashes,
    policy: policyResult,
    closed_positions: closedPositions,
    current_allocation: currentAllocation
  };
}
