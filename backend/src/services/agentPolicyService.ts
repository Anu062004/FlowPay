import { env } from "../config/env.js";
import { db } from "../db/pool.js";
import { getCompanySettings } from "./settingsService.js";
import type { AgentPolicyResult } from "./agentLogService.js";

export type AgentActionType =
  | "treasury_allocation"
  | "loan_disbursement"
  | "payroll"
  | "aave_rebalance"
  | "investment_rebalance";

export type AgentPolicyEvaluationInput = {
  companyId: string;
  action: AgentActionType;
  amount: number;
  metadata?: {
    allocationPct?: number;
    currentTreasuryBalance?: number;
    employeeId?: string;
  };
};

function round(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return parseFloat(value.toFixed(6));
}

function getSmallAllocationExemptionAmount() {
  const parsed = parseFloat(env.INVESTMENT_SMALL_ALLOCATION_EXEMPTION_AMOUNT ?? "10");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10;
}

function permissionForAction(
  settings: Awaited<ReturnType<typeof getCompanySettings>>,
  action: AgentActionType
) {
  const policy = settings.agent.walletPolicy;
  if (action === "treasury_allocation") return policy.allowTreasuryAllocation;
  if (action === "loan_disbursement") return policy.allowLoanDisbursal;
  if (action === "payroll") return policy.allowPayroll;
  return policy.allowAaveRebalance;
}

export async function evaluateAgentPolicy(
  input: AgentPolicyEvaluationInput
): Promise<AgentPolicyResult> {
  const settings = await getCompanySettings(input.companyId);
  const policy = settings.agent.walletPolicy;
  const checks: Array<Record<string, unknown>> = [];
  const reasons: string[] = [];

  const outflowResult = await db.query(
    `SELECT COALESCE(SUM(t.amount), 0) AS total
     FROM transactions t
     JOIN wallets w ON w.id = t.wallet_id
     JOIN companies c ON c.treasury_wallet_id = w.id
     WHERE c.id = $1
       AND t.type IN ('payroll', 'loan_disbursement', 'investment', 'treasury_allocation')
       AND t.created_at >= date_trunc('day', now())`,
    [input.companyId]
  );

  const usedDailyOutflow = round(Number(outflowResult.rows[0]?.total ?? 0));

  if (!settings.agent.enabled) {
    reasons.push("Agent runtime is disabled in company settings.");
    checks.push({
      name: "agent_enabled",
      passed: false,
      value: settings.agent.enabled
    });
  } else {
    checks.push({
      name: "agent_enabled",
      passed: true,
      value: settings.agent.enabled
    });
  }

  const permissionAllowed = permissionForAction(settings, input.action);
  if (!permissionAllowed) {
    reasons.push(`Permission disabled for ${input.action.replace(/_/g, " ")}.`);
  }
  checks.push({
    name: "permission",
    passed: permissionAllowed,
    value: permissionAllowed,
    action: input.action
  });

  const withinSingleTransfer = input.amount <= policy.maxSingleTransfer;
  if (!withinSingleTransfer) {
    reasons.push(
      `Requested amount ${round(input.amount)} exceeds max single transfer ${round(policy.maxSingleTransfer)}.`
    );
  }
  checks.push({
    name: "max_single_transfer",
    passed: withinSingleTransfer,
    limit: policy.maxSingleTransfer,
    amount: round(input.amount)
  });

  const withinDailyOutflow = usedDailyOutflow + input.amount <= policy.maxDailyOutflow;
  if (!withinDailyOutflow) {
    reasons.push(
      `Daily outflow would reach ${round(usedDailyOutflow + input.amount)} above cap ${round(policy.maxDailyOutflow)}.`
    );
  }
  checks.push({
    name: "max_daily_outflow",
    passed: withinDailyOutflow,
    limit: policy.maxDailyOutflow,
    usedToday: usedDailyOutflow,
    projected: round(usedDailyOutflow + input.amount)
  });

  if (input.action === "loan_disbursement") {
    const withinLoanCap = input.amount <= policy.maxLoanAmount;
    if (!withinLoanCap) {
      reasons.push(
        `Loan amount ${round(input.amount)} exceeds policy cap ${round(policy.maxLoanAmount)}.`
      );
    }
    checks.push({
      name: "max_loan_amount",
      passed: withinLoanCap,
      limit: policy.maxLoanAmount,
      amount: round(input.amount)
    });
  }

  if (
    (
      input.action === "treasury_allocation" ||
      input.action === "aave_rebalance" ||
      input.action === "investment_rebalance"
    ) &&
    typeof input.metadata?.allocationPct === "number"
  ) {
    const smallAllocationExemptionAmount = getSmallAllocationExemptionAmount();
    const exemptSmallInvestment =
      input.action === "investment_rebalance" && input.amount <= smallAllocationExemptionAmount;
    const withinExposure =
      exemptSmallInvestment || input.metadata.allocationPct <= policy.maxAaveAllocationPct;
    if (!withinExposure) {
      reasons.push(
        `Allocation ${round(input.metadata.allocationPct)}% exceeds investment exposure cap ${round(policy.maxAaveAllocationPct)}%.`
      );
    }
    checks.push({
      name: "max_investment_allocation_pct",
      passed: withinExposure,
      limit: policy.maxAaveAllocationPct,
      allocationPct: round(input.metadata.allocationPct),
      exemptSmallInvestment,
      exemptionAmount: smallAllocationExemptionAmount
    });
  }

  let status: AgentPolicyResult["status"] = reasons.length > 0 ? "block" : "allow";
  if (status === "allow" && input.amount > policy.humanReviewAbove) {
    status = "review";
    checks.push({
      name: "human_review_threshold",
      passed: false,
      threshold: policy.humanReviewAbove,
      amount: round(input.amount)
    });
  } else {
    checks.push({
      name: "human_review_threshold",
      passed: true,
      threshold: policy.humanReviewAbove,
      amount: round(input.amount)
    });
  }

  if (status === "review") {
    reasons.push(
      `Amount ${round(input.amount)} is above the human review threshold ${round(policy.humanReviewAbove)}.`
    );
  }

  return {
    status,
    reasons,
    checks,
    amount: round(input.amount),
    limits: {
      maxSingleTransfer: policy.maxSingleTransfer,
      maxDailyOutflow: policy.maxDailyOutflow,
      maxLoanAmount: policy.maxLoanAmount,
      maxInvestmentAllocationPct: policy.maxAaveAllocationPct,
      humanReviewAbove: policy.humanReviewAbove
    },
    metrics: {
      usedDailyOutflow,
      projectedDailyOutflow: round(usedDailyOutflow + input.amount)
    }
  };
}
