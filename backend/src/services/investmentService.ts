import {
  runInvestmentAgent,
  type InvestmentAgentInput,
  type InvestmentDecision,
  type InvestmentStrategyCandidate
} from "../agents/investmentAgent.js";
import { db } from "../db/pool.js";
import { env } from "../config/env.js";
import { logAgentAction, type AgentLogContext } from "./agentLogService.js";
import { evaluateAgentPolicy } from "./agentPolicyService.js";
import { depositToAave, getATokenBalance, getYieldEarned, withdrawFromAave } from "./aaveService.js";
import { getEthPrice } from "./priceService.js";
import { getCompanySettings } from "./settingsService.js";
import { formatTokenAmount, parseTokenAmount } from "../utils/amounts.js";

function toFixedNum(value: number): number {
  return parseFloat(value.toFixed(6));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function normalizeRiskTolerance(value: string): InvestmentAgentInput["risk_tolerance"] {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("agg")) return "aggressive";
  if (normalized.startsWith("mod")) return "moderate";
  return "conservative";
}

function riskToleranceCap(riskTolerance: InvestmentAgentInput["risk_tolerance"]) {
  if (riskTolerance === "aggressive") return 0.2;
  if (riskTolerance === "moderate") return 0.15;
  return 0.1;
}

function buildStrategyCandidates(input: {
  investmentPool: number;
  totalTreasury: number;
  atokenBalance: number;
  yieldEarned: number;
  priceChangePct: number;
  openPositions: number;
  payrollCoverageRatio: number;
  riskTolerance: InvestmentAgentInput["risk_tolerance"];
  maxAaveExposurePct: number;
  aaveUnavailableReason: string | null;
}): InvestmentStrategyCandidate[] {
  const volatility = clamp(Math.abs(input.priceChangePct) / 2.5, 0, 10);
  const payrollStress =
    input.payrollCoverageRatio >= 1.5
      ? 0
      : input.payrollCoverageRatio >= 1
        ? 1.5
        : input.payrollCoverageRatio > 0
          ? 3.5
          : 5;

  const currentAaveExposurePct =
    input.totalTreasury > 0 ? (input.atokenBalance / input.totalTreasury) * 100 : 0;
  const exposureStress =
    input.maxAaveExposurePct > 0
      ? clamp((currentAaveExposurePct / input.maxAaveExposurePct) * 4, 0, 4)
      : 0;

  const maxAaveExposureEth = input.totalTreasury * (input.maxAaveExposurePct / 100);
  const remainingAaveCapacityEth = Math.max(maxAaveExposureEth - input.atokenBalance, 0);
  const maxInvestableEth = Math.min(input.investmentPool, remainingAaveCapacityEth);
  const maxByPolicyPct =
    input.investmentPool > 0 ? clamp(maxInvestableEth / input.investmentPool, 0, 0.2) : 0;
  const maxByRiskPct = riskToleranceCap(input.riskTolerance);
  const aaveMaxAllocationPct = clamp(Math.min(maxByPolicyPct, maxByRiskPct), 0, 0.2);

  return [
    {
      id: "hold_treasury_eth",
      label: "Hold treasury ETH",
      asset_symbol: "ETH",
      protocol: "treasury",
      available: true,
      expected_return_score: clamp(2.5 - volatility * 0.1, 1, 4),
      risk_score: clamp(1 + Math.max(volatility - 4, 0) * 0.2, 1, 4),
      liquidity_score: 10,
      payroll_safety_score: 10,
      max_allocation_pct: 0,
      notes:
        input.payrollCoverageRatio < 1
          ? "Best defensive option while payroll coverage is thin."
          : "Keeps ETH fully liquid in treasury and avoids protocol risk."
    },
    {
      id: "aave_weth_supply",
      label: "Supply WETH to Aave",
      asset_symbol: "WETH",
      protocol: "aave",
      available: !input.aaveUnavailableReason && input.investmentPool > 0 && aaveMaxAllocationPct > 0,
      expected_return_score: clamp(6.5 + (input.yieldEarned > 0 ? 0.5 : 0) - volatility * 0.2, 2, 8),
      risk_score: clamp(3 + volatility * 0.4 + payrollStress + exposureStress, 1, 10),
      liquidity_score: 7,
      payroll_safety_score: clamp(8 - payrollStress * 2, 1, 8),
      max_allocation_pct: aaveMaxAllocationPct,
      notes: input.aaveUnavailableReason
        ? `Aave execution unavailable: ${input.aaveUnavailableReason}`
        : `Yield strategy with current Aave exposure ${currentAaveExposurePct.toFixed(2)}% and max new allocation ${(aaveMaxAllocationPct * 100).toFixed(1)}% of the investment pool.`
    },
    {
      id: "de_risk_to_treasury",
      label: "Withdraw back to treasury",
      asset_symbol: "ETH",
      protocol: "treasury",
      available: !input.aaveUnavailableReason && input.openPositions > 0,
      expected_return_score: 2,
      risk_score: 1,
      liquidity_score: 10,
      payroll_safety_score: 10,
      max_allocation_pct: 0,
      notes:
        input.openPositions > 0
          ? "Unwinds active Aave exposure and restores maximum treasury liquidity."
          : "No active Aave positions are available to de-risk."
    }
  ];
}

function fallbackInvestmentDecision(
  input: InvestmentAgentInput,
  reason?: string
): InvestmentDecision {
  const aaveCandidate = input.strategy_candidates.find((candidate) => candidate.id === "aave_weth_supply");
  const withdrawCandidate = input.strategy_candidates.find((candidate) => candidate.id === "de_risk_to_treasury");

  if (
    withdrawCandidate?.available &&
    (input.price_change_pct <= -8 ||
      input.payroll_coverage_ratio < 1.1 ||
      input.current_aave_exposure_pct >= input.max_aave_exposure_pct * 0.9)
  ) {
    return {
      action: "withdraw",
      strategy_id: "de_risk_to_treasury",
      target_asset: "ETH",
      target_protocol: "treasury",
      allocation_pct: 1,
      confidence: 0.72,
      risk_level: "low",
      rationale:
        reason ??
        "Fallback strategy selected de-risking because payroll safety or market conditions make treasury liquidity more important than yield."
    };
  }

  if (
    aaveCandidate?.available &&
    aaveCandidate.max_allocation_pct > 0 &&
    input.investment_pool > 0 &&
    input.payroll_coverage_ratio >= 1.25 &&
    Math.abs(input.price_change_pct) <= 6
  ) {
    return {
      action: "invest",
      strategy_id: "aave_weth_supply",
      target_asset: "WETH",
      target_protocol: "aave",
      allocation_pct: aaveCandidate.max_allocation_pct,
      confidence: 0.64,
      risk_level: input.price_change_pct >= 0 ? "low" : "medium",
      rationale:
        reason ??
        "Fallback strategy selected Aave because payroll coverage is healthy, volatility is moderate, and Aave offers the best risk-adjusted yield among approved strategies."
    };
  }

  return {
    action: "hold",
    strategy_id: "hold_treasury_eth",
    target_asset: "ETH",
    target_protocol: "treasury",
    allocation_pct: 0,
    confidence: 0.78,
    risk_level: "low",
    rationale:
      reason ??
      "Fallback strategy selected treasury hold because no approved yield strategy offered enough return advantage for the observed risk."
  };
}

function sanitizeInvestmentDecision(
  decision: InvestmentDecision,
  input: InvestmentAgentInput
): InvestmentDecision {
  const selected = input.strategy_candidates.find((candidate) => candidate.id === decision.strategy_id);
  if (!selected || !selected.available) {
    return fallbackInvestmentDecision(
      input,
      `Selected strategy ${decision.strategy_id} was unavailable, so FlowPay fell back to the safest approved option.`
    );
  }

  if (decision.action === "invest") {
    if (selected.id !== "aave_weth_supply" || selected.protocol !== "aave") {
      return fallbackInvestmentDecision(
        input,
        "Investment action was mapped to a non-yield strategy, so FlowPay fell back to the safest approved option."
      );
    }

    return {
      ...decision,
      strategy_id: selected.id,
      target_asset: selected.asset_symbol,
      target_protocol: selected.protocol,
      allocation_pct: clamp(
        Math.min(decision.allocation_pct, selected.max_allocation_pct),
        0,
        selected.max_allocation_pct
      )
    };
  }

  if (decision.action === "withdraw") {
    if (selected.id !== "de_risk_to_treasury") {
      return fallbackInvestmentDecision(
        input,
        "Withdraw action was mapped to an invalid strategy, so FlowPay fell back to the safest approved option."
      );
    }

    return {
      ...decision,
      strategy_id: selected.id,
      target_asset: "ETH",
      target_protocol: "treasury",
      allocation_pct: decision.allocation_pct > 0 ? clamp(decision.allocation_pct, 0, 1) : 1
    };
  }

  return {
    ...decision,
    action: "hold",
    strategy_id: "hold_treasury_eth",
    target_asset: "ETH",
    target_protocol: "treasury",
    allocation_pct: 0
  };
}

function describeDecision(decision: InvestmentDecision): string {
  if (decision.action === "invest") {
    return `Selected ${decision.strategy_id} at ${(decision.allocation_pct * 100).toFixed(1)}% of the investment pool.`;
  }
  if (decision.action === "withdraw") {
    return "Selected de-risking back to treasury liquidity.";
  }
  return "Selected treasury hold as the safest approved strategy.";
}

export async function runInvestment(companyId: string, auditContext: AgentLogContext = {}) {
  const [allocationResult, payrollResult, settings] = await Promise.all([
    db.query(
      `SELECT investment_pool, payroll_reserve, lending_pool, main_reserve
       FROM treasury_allocations
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [companyId]
    ),
    db.query(
      "SELECT COALESCE(SUM(salary), 0) AS total_salary FROM employees WHERE company_id = $1 AND status = 'active'",
      [companyId]
    ),
    getCompanySettings(companyId)
  ]);

  const investmentPool = allocationResult.rowCount
    ? parseFloat(allocationResult.rows[0].investment_pool)
    : 0;
  const payrollReserve = parseFloat(allocationResult.rows[0]?.payroll_reserve ?? "0");
  const lendingPool = parseFloat(allocationResult.rows[0]?.lending_pool ?? "0");
  const mainReserve = parseFloat(allocationResult.rows[0]?.main_reserve ?? "0");
  const totalTreasury = investmentPool + payrollReserve + lendingPool + mainReserve;
  const monthlyPayroll = parseFloat(payrollResult.rows[0]?.total_salary ?? "0");
  const payrollCoverageRatio =
    monthlyPayroll > 0 ? payrollReserve / monthlyPayroll : payrollReserve > 0 ? 999 : 0;

  let atokenBalance = 0;
  let yieldEarned = 0;
  let aaveUnavailableReason: string | null = null;
  try {
    atokenBalance = await getATokenBalance(companyId);
    yieldEarned = await getYieldEarned(companyId);
  } catch (error) {
    aaveUnavailableReason = error instanceof Error ? error.message : "Aave unavailable";
  }

  const activePositionsResult = await db.query(
    "SELECT COUNT(*) AS count FROM investment_positions WHERE company_id = $1 AND status = 'active'",
    [companyId]
  );
  const openPositions = parseInt(activePositionsResult.rows[0].count, 10);
  const priceInfo = await getEthPrice();
  const riskTolerance = normalizeRiskTolerance(settings.agent.riskTolerance);
  const currentAaveExposurePct = totalTreasury > 0 ? (atokenBalance / totalTreasury) * 100 : 0;
  const strategyCandidates = buildStrategyCandidates({
    investmentPool,
    totalTreasury,
    atokenBalance,
    yieldEarned,
    priceChangePct: priceInfo.changePct,
    openPositions,
    payrollCoverageRatio,
    riskTolerance,
    maxAaveExposurePct: settings.agent.walletPolicy.maxAaveAllocationPct,
    aaveUnavailableReason
  });

  const agentInput: InvestmentAgentInput = {
    balance: investmentPool,
    investment_pool: investmentPool,
    eth_price: priceInfo.price,
    price_change_pct: priceInfo.changePct,
    atoken_balance: atokenBalance,
    yield_earned: yieldEarned,
    open_positions: openPositions,
    monthly_payroll: monthlyPayroll,
    payroll_coverage_ratio: toFixedNum(payrollCoverageRatio),
    current_aave_exposure_pct: toFixedNum(currentAaveExposurePct),
    max_aave_exposure_pct: settings.agent.walletPolicy.maxAaveAllocationPct,
    risk_tolerance: riskTolerance,
    strategy_candidates: strategyCandidates
  };

  let decision: InvestmentDecision;
  try {
    const modelDecision = await runInvestmentAgent(agentInput);
    decision = sanitizeInvestmentDecision(modelDecision, agentInput);
  } catch (error) {
    decision = fallbackInvestmentDecision(
      agentInput,
      `Agent fallback: ${error instanceof Error ? error.message : "investment agent unavailable"}`
    );
  }

  await logAgentAction(
    "InvestmentAgent",
    agentInput,
    decision,
    decision.rationale,
    describeDecision(decision),
    companyId,
    {
      ...auditContext,
      stage: "decision",
      metadata: {
        strategyId: decision.strategy_id,
        confidence: decision.confidence,
        riskLevel: decision.risk_level
      }
    }
  );

  if (aaveUnavailableReason) {
    const safeDecision = fallbackInvestmentDecision(
      agentInput,
      `Aave unavailable: ${aaveUnavailableReason}. FlowPay kept funds in treasury instead of forcing an investment action.`
    );
    await logAgentAction(
      "InvestmentAgent",
      agentInput,
      safeDecision,
      safeDecision.rationale,
      "Skipped investment execution because Aave context was unavailable.",
      companyId,
      {
        ...auditContext,
        stage: "wdk_execution",
        executionStatus: "skipped",
        metadata: {
          strategyId: safeDecision.strategy_id
        }
      }
    );
    return { ...safeDecision, invested_amount: 0, txHash: null };
  }

  if (decision.action === "invest" && decision.strategy_id === "aave_weth_supply" && decision.allocation_pct > 0) {
    const investAmount = investmentPool * decision.allocation_pct;
    const aaveDecimals = parseInt(env.AAVE_SUPPLY_TOKEN_DECIMALS, 10);
    let investAmountRaw = 0n;
    let normalizedInvestAmount = 0;

    if (Number.isFinite(investAmount) && investAmount > 0) {
      investAmountRaw = parseTokenAmount(investAmount.toFixed(aaveDecimals), aaveDecimals);
      normalizedInvestAmount = parseFloat(formatTokenAmount(investAmountRaw, aaveDecimals));
    }

    if (investAmountRaw <= 0n || normalizedInvestAmount <= 0) {
      await logAgentAction(
        "InvestmentAgent",
        agentInput,
        decision,
        "Skipped invest because the computed allocation rounded down to zero.",
        "Investment execution skipped because the computed deposit amount was zero.",
        companyId,
        {
          ...auditContext,
          stage: "wdk_execution",
          executionStatus: "skipped",
          metadata: {
            strategyId: decision.strategy_id
          }
        }
      );
      return { ...decision, invested_amount: 0, txHash: null };
    }

    const projectedExposurePct =
      totalTreasury > 0 ? ((atokenBalance + normalizedInvestAmount) / totalTreasury) * 100 : 0;
    const policyResult = await evaluateAgentPolicy({
      companyId,
      action: "aave_rebalance",
      amount: normalizedInvestAmount,
      metadata: {
        allocationPct: projectedExposurePct,
        currentTreasuryBalance: totalTreasury
      }
    });

    await logAgentAction(
      "FlowPayPolicyEngine",
      {
        companyId,
        investAmount: normalizedInvestAmount,
        projectedExposurePct,
        totalTreasury,
        strategyId: decision.strategy_id
      },
      {
        action: "aave_rebalance",
        strategy_id: decision.strategy_id
      },
      policyResult.reasons.join(" ") || "Investment action passed wallet policy checks.",
      `Investment policy status: ${policyResult.status.toUpperCase()}`,
      companyId,
      {
        ...auditContext,
        stage: "policy_validation",
        policyResult,
        executionStatus: policyResult.status,
        metadata: {
          strategyId: decision.strategy_id
        }
      }
    );

    if (policyResult.status === "block") {
      return { ...decision, invested_amount: 0, txHash: null, policy: policyResult };
    }

    try {
      const txHash = await depositToAave(companyId, normalizedInvestAmount);
      const updatedATokenBalance = await getATokenBalance(companyId);
      const updatedYieldEarned = await getYieldEarned(companyId);

      await db.query(
        `INSERT INTO investment_positions
         (company_id, amount_deposited, atoken_balance, yield_earned, entry_price, tx_hash, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
        [
          companyId,
          toFixedNum(normalizedInvestAmount),
          toFixedNum(updatedATokenBalance),
          toFixedNum(updatedYieldEarned),
          toFixedNum(priceInfo.price),
          txHash
        ]
      );

      await logAgentAction(
        "InvestmentAgent",
        agentInput,
        decision,
        decision.rationale,
        `Executed ${decision.strategy_id} for ${normalizedInvestAmount.toFixed(6)} ETH. Tx: ${txHash}`,
        companyId,
        {
          ...auditContext,
          stage: "wdk_execution",
          policyResult,
          executionStatus: "success",
          metadata: {
            strategyId: decision.strategy_id,
            txHash
          }
        }
      );

      return { ...decision, invested_amount: normalizedInvestAmount, txHash, policy: policyResult };
    } catch (error) {
      await logAgentAction(
        "InvestmentAgent",
        agentInput,
        decision,
        error instanceof Error ? error.message : "Aave deposit failed.",
        `Investment execution failed for ${normalizedInvestAmount.toFixed(6)} ETH.`,
        companyId,
        {
          ...auditContext,
          stage: "wdk_execution",
          executionStatus: "failed",
          metadata: {
            strategyId: decision.strategy_id
          }
        }
      );
      throw error;
    }
  }

  const activePositionsDetail = await db.query(
    "SELECT id, amount_deposited, entry_price FROM investment_positions WHERE company_id = $1 AND status = 'active' ORDER BY opened_at ASC",
    [companyId]
  );

  if (decision.action === "withdraw" && decision.strategy_id === "de_risk_to_treasury" && (activePositionsDetail.rowCount ?? 0) > 0) {
    for (const pos of activePositionsDetail.rows) {
      const withdrawAmount = parseFloat(pos.amount_deposited);
      try {
        const txHash = await withdrawFromAave(companyId, withdrawAmount);
        await db.query(
          "UPDATE investment_positions SET status = 'closed', closed_at = now() WHERE id = $1",
          [pos.id]
        );
        await logAgentAction(
          "InvestmentAgent",
          agentInput,
          decision,
          decision.rationale,
          `Withdrew ${withdrawAmount.toFixed(6)} ETH from Aave under ${decision.strategy_id}. Tx: ${txHash}`,
          companyId,
          {
            ...auditContext,
            stage: "wdk_execution",
            executionStatus: "success",
            metadata: {
              strategyId: decision.strategy_id,
              txHash
            }
          }
        );
      } catch (error) {
        await db.query("UPDATE investment_positions SET status = 'sync_failed' WHERE id = $1", [pos.id]);
        const errorMessage = error instanceof Error ? error.message : "Unknown withdrawal error";
        await logAgentAction(
          "InvestmentAgent",
          agentInput,
          decision,
          errorMessage,
          `WITHDRAWAL_FAILED for ${withdrawAmount.toFixed(6)} ETH on position ${pos.id}`,
          companyId,
          {
            ...auditContext,
            stage: "wdk_execution",
            executionStatus: "failed",
            metadata: {
              strategyId: decision.strategy_id
            }
          }
        );
      }
    }
  }

  if (decision.action === "hold" && (activePositionsDetail.rowCount ?? 0) > 0) {
    for (const pos of activePositionsDetail.rows) {
      const entryPrice = parseFloat(pos.entry_price);
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
        continue;
      }

      const priceDropPct = ((entryPrice - priceInfo.price) / entryPrice) * 100;
      if (priceDropPct <= 15) {
        continue;
      }

      const withdrawAmount = parseFloat(pos.amount_deposited);
      try {
        const txHash = await withdrawFromAave(companyId, withdrawAmount);
        await db.query(
          "UPDATE investment_positions SET status = 'closed', closed_at = now() WHERE id = $1",
          [pos.id]
        );
        await logAgentAction(
          "InvestmentAgent",
          agentInput,
          decision,
          decision.rationale,
          `Hold-mode stop loss triggered (${priceDropPct.toFixed(2)}% drop). Withdrew ${withdrawAmount.toFixed(6)} ETH. Tx: ${txHash}`,
          companyId,
          {
            ...auditContext,
            stage: "wdk_execution",
            executionStatus: "success",
            metadata: {
              strategyId: decision.strategy_id,
              txHash
            }
          }
        );
      } catch (error) {
        await db.query("UPDATE investment_positions SET status = 'sync_failed' WHERE id = $1", [pos.id]);
        const errorMessage = error instanceof Error ? error.message : "Unknown withdrawal error";
        await logAgentAction(
          "InvestmentAgent",
          agentInput,
          decision,
          errorMessage,
          `WITHDRAWAL_FAILED during hold stop-loss for ${withdrawAmount.toFixed(6)} ETH on position ${pos.id}`,
          companyId,
          {
            ...auditContext,
            stage: "wdk_execution",
            executionStatus: "failed",
            metadata: {
              strategyId: decision.strategy_id
            }
          }
        );
      }
    }
  }

  return decision;
}
