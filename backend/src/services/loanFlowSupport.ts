import { db } from "../db/pool.js";
import {
  issueContractLoan,
  recordLoanDisbursementOnCore,
  syncEmployeeCreditScoreOnCore
} from "./contractService.js";
import { logAgentAction, type AgentLogContext } from "./agentLogService.js";
import { sendTransaction } from "./walletService.js";

export type ScoreTierContext = {
  label: "450-499" | "500-699" | "700-849" | "850-1000";
  tierMin: number;
  tierMax: number;
  maxMultiplier: number;
};

export type RepaymentMetrics = {
  totalClosed: number;
  closedOnTime: number;
  repaymentRate: number;
  avgDaysToClose: number;
  missedEmiCount: number;
  hasPriorLoans: boolean;
};

export type LoanExecutionRow = {
  id: string;
  amount: string;
  interest_rate: string;
  duration_months: string;
  status: string;
  salary: string;
  employee_id: string;
  employee_name: string;
  employee_email: string | null;
  company_id: string;
  wallet_id: string;
  wallet_address: string;
  treasury_wallet_id: string;
};

export function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateEmi(amount: number, annualInterestRate: number, durationMonths: number) {
  const monthlyRate = annualInterestRate / 100 / 12;
  if (monthlyRate === 0) {
    return amount / durationMonths;
  }
  const numerator = amount * monthlyRate * Math.pow(1 + monthlyRate, durationMonths);
  const denominator = Math.pow(1 + monthlyRate, durationMonths) - 1;
  return numerator / denominator;
}

export function getScoreTierContext(score: number): ScoreTierContext | null {
  if (score >= 850) {
    return { label: "850-1000", tierMin: 850, tierMax: 1000, maxMultiplier: 3 };
  }
  if (score >= 700) {
    return { label: "700-849", tierMin: 700, tierMax: 849, maxMultiplier: 2 };
  }
  if (score >= 500) {
    return { label: "500-699", tierMin: 500, tierMax: 699, maxMultiplier: 1 };
  }
  if (score >= 450) {
    return { label: "450-499", tierMin: 450, tierMax: 499, maxMultiplier: 0.5 };
  }
  return null;
}

export function buildFallbackLoanDecision(input: {
  salary: number;
  requestedAmount: number;
  tierLimitAmount: number;
  tierInterestRate: number;
  tierLabel: ScoreTierContext["label"];
  repaymentRate: number;
  hasPriorLoans: boolean;
}) {
  if (input.tierLabel === "450-499" && input.hasPriorLoans && input.repaymentRate < 0.7) {
    return {
      decision: "reject" as const,
      amount: input.requestedAmount,
      interest: input.tierInterestRate,
      duration: 12,
      rationale: "Fallback policy rejected the request because low-tier repayment history is too weak."
    };
  }

  let approvalFactor = 1;
  if (input.tierLabel === "450-499") {
    approvalFactor = 0.5;
  } else if (input.hasPriorLoans) {
    approvalFactor = input.repaymentRate >= 0.9 ? 1 : input.repaymentRate >= 0.7 ? 0.75 : 0.5;
  }

  const approvedAmount = Math.min(input.requestedAmount, Math.max(input.tierLimitAmount * approvalFactor, 0));
  if (approvedAmount <= 0) {
    return {
      decision: "reject" as const,
      amount: input.requestedAmount,
      interest: input.tierInterestRate,
      duration: 12,
      rationale: "Fallback policy rejected the request because the approved amount is zero."
    };
  }

  const candidateDurations = [3, 6, 9, 12, 18, 24];
  let duration = candidateDurations[candidateDurations.length - 1];
  for (const months of candidateDurations) {
    if (calculateEmi(approvedAmount, input.tierInterestRate, months) <= input.salary * 0.3) {
      duration = months;
      break;
    }
  }

  if (calculateEmi(approvedAmount, input.tierInterestRate, duration) > input.salary * 0.3) {
    return {
      decision: "reject" as const,
      amount: approvedAmount,
      interest: input.tierInterestRate,
      duration,
      rationale: "Fallback policy rejected the request because EMI would exceed 30% of salary."
    };
  }

  return {
    decision: "approve" as const,
    amount: approvedAmount,
    interest: input.tierInterestRate,
    duration,
    rationale: "Fallback policy approved the request using score-tier proof, repayment history, and repayment-cap rules."
  };
}

export async function syncEmployeeCreditScore(
  companyId: string,
  employeeId: string,
  walletAddress: string,
  salary: string | number
) {
  const score = await syncEmployeeCreditScoreOnCore(walletAddress, salary, {
    companyId
  });
  await db.query("UPDATE employees SET credit_score = $1 WHERE id = $2", [score, employeeId]);
  return score;
}

export async function getEmployeeRepaymentMetrics(employeeId: string): Promise<RepaymentMetrics> {
  const result = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'repaid') AS total_closed,
       COUNT(*) FILTER (
         WHERE status = 'repaid'
           AND updated_at <= created_at + (duration_months::text || ' months')::interval
       ) AS closed_on_time,
       AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400.0) FILTER (WHERE status = 'repaid') AS avg_days_to_close,
       COALESCE(
         SUM(
           CASE
             WHEN status IN ('active', 'repaid', 'expired') THEN
               GREATEST(
                 FLOOR(
                   EXTRACT(
                     EPOCH FROM (
                       (CASE WHEN status = 'repaid' THEN updated_at ELSE now() END) -
                       (created_at + (duration_months::text || ' months')::interval)
                     )
                   ) / 2592000.0
                 ),
                 0
               )
             ELSE 0
           END
         ),
         0
       ) AS missed_emi_count
     FROM loans
     WHERE employee_id = $1`,
    [employeeId]
  );

  const row = result.rows[0] ?? {};
  const totalClosed = toNumber(row.total_closed);
  const closedOnTime = toNumber(row.closed_on_time);
  return {
    totalClosed,
    closedOnTime,
    repaymentRate: totalClosed > 0 ? closedOnTime / totalClosed : 0,
    avgDaysToClose: totalClosed > 0 ? toNumber(row.avg_days_to_close) : 0,
    missedEmiCount: toNumber(row.missed_emi_count),
    hasPriorLoans: totalClosed > 0
  };
}

export async function insertRejectedLoan(
  employeeId: string,
  amount: number,
  interestRate: number,
  durationMonths: number,
  reason?: string | null
) {
  const result = await db.query(
    `INSERT INTO loans (
       employee_id,
       amount,
       interest_rate,
       duration_months,
       remaining_balance,
       status,
       review_reason
     )
     VALUES ($1, $2, $3, $4, $5, 'rejected', $6)
     RETURNING id`,
    [employeeId, amount, interestRate, durationMonths, amount, reason ?? null]
  );
  return result.rows[0].id as string;
}

export async function syncLoanToContracts(input: {
  companyId: string;
  loanId: string;
  employeeId: string;
  employeeWalletAddress: string;
  salary: string;
  amount: number;
  duration: number;
}) {
  try {
    const contractSync = await issueContractLoan(
      input.companyId,
      input.employeeWalletAddress,
      input.amount.toString(),
      input.duration
    );
    await db.query(
      "UPDATE loans SET contract_synced = true, contract_loan_id = $1, interest_rate = $2 WHERE id = $3",
      [contractSync.contractLoanId, contractSync.interestRatePct, input.loanId]
    );

    try {
      await recordLoanDisbursementOnCore(input.companyId, input.employeeWalletAddress);
    } catch (error) {
      console.error(`[Blockchain] Loan disbursal event sync failed for loan ${input.loanId}:`, error);
    }

    await syncEmployeeCreditScore(input.companyId, input.employeeId, input.employeeWalletAddress, input.salary);
    console.log(`[Blockchain] Successfully synced loan ${input.loanId} to contract`);
  } catch (error) {
    console.error(`[Blockchain] Failed to sync loan ${input.loanId} to contract:`, error);
  }
}

export async function executeLoanDisbursement(
  row: LoanExecutionRow,
  policyResult: Record<string, unknown>,
  auditContext: AgentLogContext,
  onFailureStatus: "rejected" | null
) {
  let transfer: Awaited<ReturnType<typeof sendTransaction>>;
  try {
    transfer = await sendTransaction(
      row.treasury_wallet_id,
      row.wallet_address,
      parseFloat(row.amount),
      "loan_disbursement",
      row.wallet_id
    );

    await logAgentAction(
      "WDKExecutionLayer",
      {
        companyId: row.company_id,
        employeeId: row.employee_id,
        loanId: row.id,
        amount: parseFloat(row.amount)
      },
      { action: "loan_disbursement" },
      "Loan disbursal executed via WDK wallet transfer.",
      `Loan disbursal executed. Tx: ${transfer.txHash ?? "pending"}`,
      row.company_id,
      {
        ...auditContext,
        stage: "wdk_execution",
        policyResult,
        executionStatus: "success",
        metadata: {
          txHash: transfer.txHash ?? null,
          loanId: row.id
        }
      }
    );
  } catch (error) {
    if (onFailureStatus) {
      await db.query("UPDATE loans SET status = $1, updated_at = now() WHERE id = $2", [onFailureStatus, row.id]);
    }
    await logAgentAction(
      "WDKExecutionLayer",
      {
        companyId: row.company_id,
        employeeId: row.employee_id,
        loanId: row.id,
        amount: parseFloat(row.amount)
      },
      { action: "loan_disbursement" },
      error instanceof Error ? error.message : "Loan disbursal failed.",
      "Loan disbursal execution failed.",
      row.company_id,
      {
        ...auditContext,
        stage: "wdk_execution",
        policyResult,
        executionStatus: "failed",
        metadata: {
          loanId: row.id
        }
      }
    );
    throw error;
  }

  await syncLoanToContracts({
    companyId: row.company_id,
    loanId: row.id,
    employeeId: row.employee_id,
    employeeWalletAddress: row.wallet_address,
    salary: row.salary,
    amount: parseFloat(row.amount),
    duration: parseInt(row.duration_months, 10)
  });

  return transfer;
}
