import { randomUUID } from "crypto";
import { formatEther } from "ethers";
import { db } from "../db/pool.js";
import { env } from "../config/env.js";
import { runTreasuryAllocationAgent } from "../agents/treasuryAgent.js";
import { ApiError } from "../utils/errors.js";
import { getWalletBalance, sendTransaction } from "./walletService.js";
import { allocateVault } from "./contractService.js";
import { formatTokenAmount } from "../utils/amounts.js";
import { logAgentAction, type AgentLogContext } from "./agentLogService.js";
import { evaluateAgentPolicy } from "./agentPolicyService.js";

export async function getTreasuryBalance(companyId: string) {
  const result = await db.query(
    "SELECT w.id as wallet_id FROM companies c JOIN wallets w ON c.treasury_wallet_id = w.id WHERE c.id = $1",
    [companyId]
  );
  if (result.rowCount === 0) {
    throw new ApiError(404, "Company treasury wallet not found");
  }
  const balance = await getWalletBalance(result.rows[0].wallet_id);
  return {
    ...balance,
    balance: balance.balanceEth,
    wallet_address: balance.walletAddress,
    token_symbol: balance.tokenSymbol
  };
}

export async function allocateTreasury(
  companyId: string,
  balanceWei: bigint,
  auditContext: AgentLogContext = {}
) {
  const useToken = Boolean(env.TREASURY_TOKEN_ADDRESS && env.TREASURY_TOKEN_SYMBOL);
  const decimals = useToken ? parseInt(env.TREASURY_TOKEN_DECIMALS, 10) : 18;
  const balanceEth = useToken
    ? parseFloat(formatTokenAmount(balanceWei, decimals))
    : parseFloat(formatEther(balanceWei));
  const payrollResult = await db.query(
    "SELECT COALESCE(SUM(salary), 0) as total_salary FROM employees WHERE company_id = $1",
    [companyId]
  );
  const loanResult = await db.query(
    "SELECT COALESCE(SUM(remaining_balance), 0) as outstanding_loans FROM loans l JOIN employees e ON l.employee_id = e.id WHERE e.company_id = $1 AND l.status = 'active'",
    [companyId]
  );

  const context = {
    balance: balanceEth,
    monthly_payroll: parseFloat(payrollResult.rows[0].total_salary),
    outstanding_loans: parseFloat(loanResult.rows[0].outstanding_loans)
  };

  const allocation = await runTreasuryAllocationAgent(context).catch(() => null);
  const payrollPct = allocation?.payroll_reserve_pct ?? parseFloat(env.TREASURY_PAYROLL_RESERVE_PCT);
  const lendingPct = allocation?.lending_pool_pct ?? parseFloat(env.TREASURY_LENDING_PCT);
  const investmentPct = allocation?.investment_pool_pct ?? parseFloat(env.TREASURY_INVESTMENT_PCT);

  if (Math.abs(payrollPct + lendingPct + investmentPct - 1) > 0.01) {
    throw new ApiError(400, "Invalid treasury allocation percentages");
  }

  const payrollReserve = balanceEth * payrollPct;
  const lendingPool = balanceEth * lendingPct;
  const investmentPool = balanceEth * investmentPct;

  const decisionPayload = allocation ?? {
    payroll_reserve_pct: payrollPct,
    lending_pool_pct: lendingPct,
    investment_pool_pct: investmentPct,
    rationale: "Fallback treasury allocation policy applied."
  };

  await logAgentAction(
    "TreasuryAllocationAgent",
    context,
    decisionPayload,
    String(decisionPayload.rationale ?? "Treasury allocation calculated."),
    `Proposed allocation: ${(payrollPct * 100).toFixed(1)}% payroll, ${(lendingPct * 100).toFixed(1)}% lending, ${(investmentPct * 100).toFixed(1)}% investment.`,
    companyId,
    {
      ...auditContext,
      stage: "decision"
    }
  );

  const policyResult = await evaluateAgentPolicy({
    companyId,
    action: "treasury_allocation",
    amount: investmentPool,
    metadata: {
      allocationPct: investmentPct * 100,
      currentTreasuryBalance: balanceEth
    }
  });

  await logAgentAction(
    "FlowPayPolicyEngine",
    {
      companyId,
      investmentPool,
      allocationPct: investmentPct * 100,
      balanceEth
    },
    {
      action: "treasury_allocation"
    },
    policyResult.reasons.join(" ") || "Treasury allocation passed wallet policy checks.",
    `Treasury allocation policy status: ${policyResult.status.toUpperCase()}`,
    companyId,
    {
      ...auditContext,
      stage: "policy_validation",
      policyResult,
      executionStatus: policyResult.status
    }
  );

  if (policyResult.status === "block") {
    throw new ApiError(400, policyResult.reasons[0] ?? "Treasury allocation blocked by policy");
  }

  // 1. DB Commit
  await db.query(
    "INSERT INTO treasury_allocations (company_id, payroll_reserve, lending_pool, investment_pool) VALUES ($1, $2, $3, $4)",
    [companyId, payrollReserve.toFixed(6), lendingPool.toFixed(6), investmentPool.toFixed(6)]
  );

  // 2. Sync to contract - AWAIT THIS to ensure chain success
  try {
    await allocateVault(payrollPct, lendingPct, investmentPct);
    await logAgentAction(
      "WDKExecutionLayer",
      {
        companyId,
        payrollReserve,
        lendingPool,
        investmentPool
      },
      {
        action: "treasury_allocation"
      },
      "Treasury allocation synced to the vault contract.",
      "Treasury allocation execution succeeded.",
      companyId,
      {
        ...auditContext,
        stage: "wdk_execution",
        policyResult,
        executionStatus: "success"
      }
    );
  } catch (error) {
    console.error(`[Blockchain] Failed to sync treasury allocation for company ${companyId}:`, error);
    await logAgentAction(
      "WDKExecutionLayer",
      {
        companyId,
        payrollReserve,
        lendingPool,
        investmentPool
      },
      {
        action: "treasury_allocation"
      },
      error instanceof Error ? error.message : "Failed to sync treasury allocation to contract.",
      "Treasury allocation execution failed.",
      companyId,
      {
        ...auditContext,
        stage: "wdk_execution",
        policyResult,
        executionStatus: "failed"
      }
    );
  }

  return {
    payroll_reserve: payrollReserve,
    lending_pool: lendingPool,
    investment_pool: investmentPool,
    policy: policyResult,
    allocation: {
      payroll_reserve_pct: payrollPct,
      lending_pool_pct: lendingPct,
      investment_pool_pct: investmentPct
    }
  };
}

export async function runReserveTreasuryTopup(input: {
  companyId: string;
  amount: number;
  reason?: string;
  source?: string;
  taskId?: string;
}) {
  const workflowId = randomUUID();
  const workflowName = "reserve_treasury_topup";
  const source = input.source ?? "openclaw_clawbot";
  const auditContext: AgentLogContext = {
    workflowId,
    workflowName,
    source
  };

  if (!env.RESERVE_TOPUP_ENABLED) {
    throw new ApiError(400, "Reserve treasury top-ups are disabled");
  }
  if (!env.RESERVE_WALLET_ID) {
    throw new ApiError(400, "RESERVE_WALLET_ID is required for automated treasury top-ups");
  }

  const amount = Number.parseFloat(input.amount.toString());
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, "Treasury top-up amount must be greater than zero");
  }

  const maxTopupAmount = Number.parseFloat(env.RESERVE_TOPUP_MAX_AMOUNT);
  const companyResult = await db.query(
    `SELECT c.id, c.name, w.id AS treasury_wallet_id, w.wallet_address AS treasury_wallet_address
     FROM companies c
     JOIN wallets w ON c.treasury_wallet_id = w.id
     WHERE c.id = $1`,
    [input.companyId]
  );
  if ((companyResult.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Company treasury wallet not found");
  }

  const company = companyResult.rows[0] as {
    id: string;
    name: string;
    treasury_wallet_id: string;
    treasury_wallet_address: string;
  };

  const reserveBalance = await getWalletBalance(env.RESERVE_WALLET_ID);
  const reserveAvailable = Number.parseFloat(reserveBalance.balanceEth);

  await logAgentAction(
    "ReserveFundingAgent",
    {
      companyId: company.id,
      companyName: company.name,
      requestedAmount: amount,
      reserveWalletId: env.RESERVE_WALLET_ID,
      reserveWalletAddress: reserveBalance.walletAddress,
      treasuryWalletId: company.treasury_wallet_id,
      treasuryWalletAddress: company.treasury_wallet_address,
      reason: input.reason ?? null
    },
    {
      action: "reserve_treasury_topup"
    },
    input.reason ?? "Automated treasury top-up requested from the reserve wallet.",
    "Reserve top-up request prepared.",
    company.id,
    {
      ...auditContext,
      stage: "decision",
      executionStatus: "started",
      metadata: {
        taskId: input.taskId ?? null,
        tokenSymbol: reserveBalance.tokenSymbol
      }
    }
  );

  const reasons: string[] = [];
  const checks: Array<Record<string, unknown>> = [
    {
      name: "reserve_topup_enabled",
      passed: true,
      value: env.RESERVE_TOPUP_ENABLED
    },
    {
      name: "max_reserve_topup_amount",
      passed: amount <= maxTopupAmount,
      limit: maxTopupAmount,
      amount
    },
    {
      name: "reserve_wallet_balance",
      passed: reserveAvailable >= amount,
      available: reserveAvailable,
      amount
    }
  ];

  if (amount > maxTopupAmount) {
    reasons.push(`Requested amount ${amount.toFixed(6)} exceeds reserve top-up cap ${maxTopupAmount.toFixed(6)}.`);
  }
  if (reserveAvailable < amount) {
    reasons.push(`Reserve wallet balance ${reserveAvailable.toFixed(6)} is below required top-up ${amount.toFixed(6)}.`);
  }

  const policyResult = {
    status: reasons.length > 0 ? "block" : "allow",
    reasons,
    checks,
    amount,
    limits: {
      reserveTopupMaxAmount: maxTopupAmount
    },
    metrics: {
      reserveAvailable
    }
  } as const;

  await logAgentAction(
    "FlowPayPolicyEngine",
    {
      companyId: company.id,
      requestedAmount: amount,
      reserveAvailable,
      reserveWalletId: env.RESERVE_WALLET_ID
    },
    {
      action: "reserve_treasury_topup"
    },
    policyResult.reasons.join(" ") || "Reserve treasury top-up passed reserve wallet policy checks.",
    `Reserve treasury top-up policy status: ${policyResult.status.toUpperCase()}`,
    company.id,
    {
      ...auditContext,
      stage: "policy_validation",
      policyResult,
      executionStatus: policyResult.status
    }
  );

  if (policyResult.status === "block") {
    throw new ApiError(400, policyResult.reasons[0] ?? "Reserve treasury top-up blocked by policy");
  }

  try {
    const transfer = await sendTransaction(
      env.RESERVE_WALLET_ID,
      company.treasury_wallet_address,
      amount,
      "treasury_allocation"
    );

    await logAgentAction(
      "WDKExecutionLayer",
      {
        companyId: company.id,
        amount,
        treasuryWalletAddress: company.treasury_wallet_address,
        reserveWalletId: env.RESERVE_WALLET_ID,
        reserveWalletAddress: reserveBalance.walletAddress,
        txHash: transfer.txHash ?? null
      },
      {
        action: "reserve_treasury_topup"
      },
      "Reserve wallet transfer sent to the company treasury wallet.",
      "Treasury top-up execution succeeded.",
      company.id,
      {
        ...auditContext,
        stage: "wdk_execution",
        policyResult,
        executionStatus: "success",
        metadata: {
          taskId: input.taskId ?? null,
          tokenSymbol: reserveBalance.tokenSymbol
        }
      }
    );

    return {
      workflowId,
      workflowName,
      source,
      companyId: company.id,
      companyName: company.name,
      amount,
      txHash: transfer.txHash ?? null,
      tokenSymbol: reserveBalance.tokenSymbol,
      treasuryWalletAddress: company.treasury_wallet_address,
      reserveWalletAddress: reserveBalance.walletAddress
    };
  } catch (error) {
    await logAgentAction(
      "WDKExecutionLayer",
      {
        companyId: company.id,
        amount,
        treasuryWalletAddress: company.treasury_wallet_address,
        reserveWalletId: env.RESERVE_WALLET_ID,
        reserveWalletAddress: reserveBalance.walletAddress
      },
      {
        action: "reserve_treasury_topup"
      },
      error instanceof Error ? error.message : "Reserve treasury top-up execution failed.",
      "Treasury top-up execution failed.",
      company.id,
      {
        ...auditContext,
        stage: "wdk_execution",
        policyResult,
        executionStatus: "failed",
        metadata: {
          taskId: input.taskId ?? null,
          tokenSymbol: reserveBalance.tokenSymbol
        }
      }
    );
    throw error;
  }
}
