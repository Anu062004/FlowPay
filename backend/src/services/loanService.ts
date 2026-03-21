import { db } from "../db/pool.js";
import { runLoanDecisionAgent } from "../agents/loanAgent.js";
import { sendTransaction } from "./walletService.js";
import { ApiError } from "../utils/errors.js";
import { getEthPrice } from "./priceService.js";
import {
  checkLoanEligibilityOnCore,
  ensureEmployeeInitializedOnCore,
  getEmployeeCreditScoreOnCore,
  issueContractLoan,
  recordLoanDisbursementOnCore,
  repayContractEMI
} from "./contractService.js";
import { logAgentAction, type AgentLogContext } from "./agentLogService.js";
import { getCompanySettings } from "./settingsService.js";
import { evaluateAgentPolicy } from "./agentPolicyService.js";

function calculateEmi(amount: number, annualInterestRate: number, durationMonths: number) {
  const monthlyRate = annualInterestRate / 100 / 12;
  if (monthlyRate === 0) {
    return amount / durationMonths;
  }
  const numerator = amount * monthlyRate * Math.pow(1 + monthlyRate, durationMonths);
  const denominator = Math.pow(1 + monthlyRate, durationMonths) - 1;
  return numerator / denominator;
}

function buildFallbackLoanDecision(input: {
  salary: number;
  creditScore: number;
  requestedAmount: number;
  changePct: number;
  maxAmount: number;
  interestRate?: number;
}) {
  const { salary, creditScore, requestedAmount, changePct, maxAmount, interestRate } = input;
  const approvedAmount = Math.min(requestedAmount, maxAmount);

  if (approvedAmount <= 0) {
    return {
      decision: "reject" as const,
      amount: requestedAmount,
      interest: 0,
      duration: 6,
      rationale: "Fallback policy rejected the request because the approved amount is zero."
    };
  }

  if (creditScore < 560) {
    return {
      decision: "reject" as const,
      amount: requestedAmount,
      interest: 0,
      duration: 6,
      rationale: "Fallback policy rejected the request due to insufficient credit quality."
    };
  }

  const stressedMarket = changePct < -10;
  const interest = interestRate ??
    creditScore >= 760 ? 4.5 :
    creditScore >= 720 ? 6 :
    creditScore >= 680 ? 7.5 :
    creditScore >= 620 ? 9.5 : 12;

  const candidateDurations = stressedMarket ? [6, 9, 12, 18, 24] : [3, 6, 9, 12, 18, 24];
  let duration = candidateDurations[candidateDurations.length - 1];

  for (const months of candidateDurations) {
    const emi = calculateEmi(approvedAmount, interest, months);
    if (emi <= salary * 0.3) {
      duration = months;
      break;
    }
  }

  const emi = calculateEmi(approvedAmount, interest, duration);
  if (emi > salary * 0.3) {
    return {
      decision: "reject" as const,
      amount: approvedAmount,
      interest,
      duration,
      rationale: "Fallback policy rejected the request because EMI would exceed 30% of salary."
    };
  }

  return {
    decision: "approve" as const,
    amount: approvedAmount,
    interest,
    duration,
    rationale: "Fallback policy approved the request using salary, credit score, and repayment-cap rules."
  };
}

async function syncEmployeeCreditScore(employeeId: string, walletAddress: string) {
  const score = await getEmployeeCreditScoreOnCore(walletAddress);
  await db.query("UPDATE employees SET credit_score = $1 WHERE id = $2", [score, employeeId]);
  return score;
}

export async function requestLoan(
  employeeId: string,
  requestedAmount: number,
  auditContext: AgentLogContext = {}
) {
  // Check if lending is paused
  const empCompanyResult = await db.query("SELECT company_id FROM employees WHERE id = $1", [employeeId]);
  if ((empCompanyResult.rowCount ?? 0) > 0) {
    const settings = await getCompanySettings(empCompanyResult.rows[0].company_id);
    if (settings.agent?.lending_paused === true) {
      throw new ApiError(403, "Lending temporarily paused due to elevated default risk");
    }
  }

  // 1. Market Context & Volatility Guard
  const { price: ethPrice, changePct } = await getEthPrice();
  if (changePct < -15) {
    throw new ApiError(400, "High volatility period — lending paused");
  }

  const result = await db.query(
    `SELECT e.id, e.full_name, e.email, e.salary, e.credit_score, e.wallet_id, e.company_id, w.wallet_address, c.treasury_wallet_id
     FROM employees e
     JOIN wallets w ON e.wallet_id = w.id
     JOIN companies c ON e.company_id = c.id
     WHERE e.id = $1`,
    [employeeId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Employee not found or missing wallet");
  }

  const employee = result.rows[0];
  const existingLoan = await db.query(
    "SELECT id, status FROM loans WHERE employee_id = $1 AND status IN ('pending', 'active') ORDER BY created_at DESC LIMIT 1",
    [employeeId]
  );
  if ((existingLoan.rowCount ?? 0) > 0) {
    throw new ApiError(400, `Existing ${existingLoan.rows[0].status} loan must be resolved before requesting another.`);
  }

  const salary = parseFloat(employee.salary);
  await ensureEmployeeInitializedOnCore(employee.wallet_address, salary, 1);
  const creditScore = await syncEmployeeCreditScore(employeeId, employee.wallet_address);
  const eligibility = await checkLoanEligibilityOnCore(employee.wallet_address);
  const maxEligibleAmount = parseFloat(eligibility.maxAmountEth);

  if (!eligibility.allowed || maxEligibleAmount <= 0) {
    throw new ApiError(400, "Employee is not eligible for a loan under FlowPayCore");
  }

  if (requestedAmount > maxEligibleAmount) {
    throw new ApiError(400, `Requested amount exceeds FlowPayCore limit (${maxEligibleAmount} ETH)`);
  }

  // 2. Agent Decision
  const agentInput = {
    salary,
    credit_score: creditScore,
    requested_amount: requestedAmount,
    eth_price_usd: ethPrice,
    price_change_24h: changePct
  };

  const decision = await runLoanDecisionAgent(agentInput).catch(() =>
    buildFallbackLoanDecision({
      salary,
      creditScore,
      requestedAmount,
      changePct,
      maxAmount: maxEligibleAmount,
      interestRate: eligibility.interestRatePct
    })
  );

  // Log Agent Decision
  await logAgentAction(
    "LoanDecisionAgent",
    agentInput,
    decision,
    decision.rationale,
    decision.decision === "approve" 
      ? `Approved loan of ${decision.amount} ETH` 
      : `Rejected loan request of ${requestedAmount} ETH`,
    employee.company_id,
    {
      ...auditContext,
      stage: "decision"
    }
  );

  if (decision.decision === "reject") {
    await db.query(
      "INSERT INTO loans (employee_id, amount, interest_rate, duration_months, remaining_balance, status) VALUES ($1, $2, $3, $4, $5, 'rejected')",
      [employeeId, requestedAmount, decision.interest, decision.duration, requestedAmount]
    );
    return { decision: "reject", rationale: decision.rationale };
  }

  // 3. Validation & EMI
  const approvedAmount = Math.min(decision.amount, maxEligibleAmount);
  const approvedInterest = eligibility.interestRatePct;

  if (approvedAmount <= 0) {
    throw new ApiError(400, "No loan amount is eligible under FlowPayCore");
  }

  const emi = calculateEmi(approvedAmount, approvedInterest, decision.duration);
  if (emi > salary * 0.3) {
    throw new ApiError(400, "EMI exceeds 30% salary policy");
  }

  const totalRepayable = emi * decision.duration;
  const policyResult = await evaluateAgentPolicy({
    companyId: employee.company_id,
    action: "loan_disbursement",
    amount: approvedAmount,
    metadata: {
      employeeId
    }
  });

  await logAgentAction(
    "FlowPayPolicyEngine",
    {
      companyId: employee.company_id,
      employeeId,
      requestedAmount,
      approvedAmount,
      emi
    },
    {
      action: "loan_disbursement"
    },
    policyResult.reasons.join(" ") || "Loan disbursal passed wallet policy checks.",
    `Loan disbursal policy status: ${policyResult.status.toUpperCase()}`,
    employee.company_id,
    {
      ...auditContext,
      stage: "policy_validation",
      policyResult,
      executionStatus: policyResult.status
    }
  );

  if (policyResult.status === "block") {
    await db.query(
      "INSERT INTO loans (employee_id, amount, interest_rate, duration_months, remaining_balance, status) VALUES ($1, $2, $3, $4, $5, 'rejected')",
      [employeeId, approvedAmount, approvedInterest, decision.duration, approvedAmount]
    );
    return {
      decision: "reject" as const,
      rationale: policyResult.reasons[0] ?? "Loan blocked by wallet policy.",
      policy: policyResult
    };
  }

  // 4. Execution
  const loanResult = await db.query(
    "INSERT INTO loans (employee_id, amount, interest_rate, duration_months, remaining_balance, status, contract_synced) VALUES ($1, $2, $3, $4, $5, $6, false) RETURNING id",
    [
      employeeId,
      approvedAmount,
      approvedInterest,
      decision.duration,
      totalRepayable,
      "active"
    ]
  );

  const loanId = loanResult.rows[0].id as string;

  try {
    const transfer = await sendTransaction(
      employee.treasury_wallet_id,
      employee.wallet_address,
      approvedAmount,
      "loan_disbursement",
      employee.wallet_id
    );

    await logAgentAction(
      "WDKExecutionLayer",
      {
        companyId: employee.company_id,
        employeeId,
        amount: approvedAmount
      },
      {
        action: "loan_disbursement"
      },
      "Loan disbursal executed via WDK wallet transfer.",
      `Loan disbursal executed. Tx: ${transfer.txHash ?? "pending"}`,
      employee.company_id,
      {
        ...auditContext,
        stage: "wdk_execution",
        policyResult,
        executionStatus: "success",
        metadata: {
          txHash: transfer.txHash ?? null,
          loanId
        }
      }
    );

    issueContractLoan(
      employee.wallet_address,
      approvedAmount.toString(),
      decision.duration
    )
      .then(async (contractSync) => {
        await db.query(
          "UPDATE loans SET contract_synced = true, contract_loan_id = $1, interest_rate = $2 WHERE id = $3",
          [contractSync.contractLoanId, contractSync.interestRatePct, loanId]
        );
        try {
          await recordLoanDisbursementOnCore(employee.wallet_address);
        } catch (error) {
          console.error(`[Blockchain] Loan disbursal event sync failed for loan ${loanId}:`, error);
        }
        await syncEmployeeCreditScore(employeeId, employee.wallet_address);
        console.log(`[Blockchain] Successfully synced loan ${loanId} to contract`);
      })
      .catch(err => {
        console.error(`[Blockchain] Failed to sync loan ${loanId} to contract:`, err.message);
      });
  } catch (error) {
    await db.query("UPDATE loans SET status = 'rejected' WHERE id = $1", [loanId]);
    await logAgentAction(
      "WDKExecutionLayer",
      {
        companyId: employee.company_id,
        employeeId,
        amount: approvedAmount
      },
      {
        action: "loan_disbursement"
      },
      error instanceof Error ? error.message : "Loan disbursal failed.",
      "Loan disbursal execution failed.",
      employee.company_id,
      {
        ...auditContext,
        stage: "wdk_execution",
        policyResult,
        executionStatus: "failed",
        metadata: {
          loanId
        }
      }
    );
    throw error;
  }

  return {
    decision: "approve",
    loanId,
    amount: approvedAmount,
    interest: approvedInterest,
    duration: decision.duration,
    emi,
    rationale: decision.rationale,
    autoApproved: true,
    policy: policyResult
  };
}

export async function executeApprovedLoan(loanId: string, auditContext: AgentLogContext = {}) {
  const result = await db.query(
    `SELECT l.id, l.amount, l.interest_rate, l.duration_months, l.status,
            e.salary,
            e.id as employee_id, e.company_id, e.wallet_id, w.wallet_address, c.treasury_wallet_id
     FROM loans l
     JOIN employees e ON e.id = l.employee_id
     JOIN wallets w ON w.id = e.wallet_id
     JOIN companies c ON c.id = e.company_id
     WHERE l.id = $1`,
    [loanId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Loan not found");
  }

  const row = result.rows[0];
  if (row.status !== "pending") {
    throw new ApiError(400, "Loan is not pending approval");
  }

  const policyResult = await evaluateAgentPolicy({
    companyId: row.company_id,
    action: "loan_disbursement",
    amount: parseFloat(row.amount),
    metadata: {
      employeeId: row.employee_id
    }
  });

  await logAgentAction(
    "FlowPayPolicyEngine",
    {
      companyId: row.company_id,
      employeeId: row.employee_id,
      loanId,
      amount: parseFloat(row.amount)
    },
    {
      action: "loan_disbursement"
    },
    policyResult.reasons.join(" ") || "Approved loan execution passed wallet policy checks.",
    `Approved loan policy status: ${policyResult.status.toUpperCase()}`,
    row.company_id,
    {
      ...auditContext,
      stage: "policy_validation",
      policyResult,
      executionStatus: policyResult.status
    }
  );

  if (policyResult.status === "block") {
    throw new ApiError(400, policyResult.reasons[0] ?? "Approved loan blocked by policy");
  }

  await ensureEmployeeInitializedOnCore(row.wallet_address, parseFloat(row.salary), 1);

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
        loanId,
        amount: parseFloat(row.amount)
      },
      {
        action: "loan_disbursement"
      },
      "Approved loan executed via WDK wallet transfer.",
      `Approved loan executed. Tx: ${transfer.txHash ?? "pending"}`,
      row.company_id,
      {
        ...auditContext,
        stage: "wdk_execution",
        policyResult,
        executionStatus: "success",
        metadata: {
          txHash: transfer.txHash ?? null
        }
      }
    );
  } catch (error) {
    await logAgentAction(
      "WDKExecutionLayer",
      {
        companyId: row.company_id,
        employeeId: row.employee_id,
        loanId,
        amount: parseFloat(row.amount)
      },
      {
        action: "loan_disbursement"
      },
      error instanceof Error ? error.message : "Approved loan execution failed.",
      "Approved loan execution failed.",
      row.company_id,
      {
        ...auditContext,
        stage: "wdk_execution",
        policyResult,
        executionStatus: "failed"
      }
    );
    throw error;
  }

  issueContractLoan(
    row.wallet_address,
    row.amount.toString(),
    parseInt(row.duration_months, 10)
  )
    .then(async (contractSync) => {
      await db.query(
        "UPDATE loans SET contract_synced = true, contract_loan_id = $1, interest_rate = $2 WHERE id = $3",
        [contractSync.contractLoanId, contractSync.interestRatePct, loanId]
      );
      try {
        await recordLoanDisbursementOnCore(row.wallet_address);
      } catch (error) {
        console.error(`[Blockchain] Loan disbursal event sync failed for approved loan ${loanId}:`, error);
      }
      await syncEmployeeCreditScore(row.employee_id, row.wallet_address);
      console.log(`[Blockchain] Successfully synced loan ${loanId} to contract`);
    })
    .catch(err => {
      console.error(`[Blockchain] Failed to sync loan ${loanId} to contract:`, err.message);
    });

  await db.query("UPDATE loans SET status = 'active', updated_at = now() WHERE id = $1", [loanId]);

  return { loanId, status: "active", policy: policyResult, txHash: transfer.txHash ?? null };
}

export async function rejectPendingLoan(loanId: string) {
  await db.query("UPDATE loans SET status = 'rejected', updated_at = now() WHERE id = $1", [loanId]);
  return { loanId, status: "rejected" };
}

export async function repayLoanInFull(loanId: string, employeeId: string) {
  const result = await db.query(
    `SELECT
       l.id,
       l.employee_id,
       l.contract_loan_id,
       l.remaining_balance,
       l.status,
       e.wallet_id AS employee_wallet_id,
       ew.wallet_address AS employee_wallet_address,
       tw.id AS treasury_wallet_id,
       tw.wallet_address AS treasury_wallet_address
     FROM loans l
     JOIN employees e ON e.id = l.employee_id
     JOIN wallets ew ON ew.id = e.wallet_id
     JOIN companies c ON c.id = e.company_id
     JOIN wallets tw ON tw.id = c.treasury_wallet_id
     WHERE l.id = $1`,
    [loanId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Loan not found");
  }

  const loan = result.rows[0];
  if (loan.employee_id !== employeeId) {
    throw new ApiError(403, "Loan does not belong to the current employee");
  }
  if (loan.status !== "active") {
    throw new ApiError(400, "Only active loans can be repaid in full");
  }
  if (!loan.employee_wallet_id || !loan.employee_wallet_address || !loan.treasury_wallet_id || !loan.treasury_wallet_address) {
    throw new ApiError(400, "Loan wallets are not configured correctly");
  }

  const remainingBalance = parseFloat(loan.remaining_balance);
  if (!Number.isFinite(remainingBalance) || remainingBalance <= 0) {
    throw new ApiError(400, "Loan has no outstanding balance");
  }

  const transfer = await sendTransaction(
    loan.employee_wallet_id,
    loan.treasury_wallet_address,
    remainingBalance,
    "emi_repayment",
    loan.treasury_wallet_id
  );

  await db.query(
    "UPDATE loans SET remaining_balance = 0, status = 'repaid', updated_at = now() WHERE id = $1",
    [loanId]
  );

  if (loan.contract_loan_id) {
    try {
      await repayContractEMI(Number(loan.contract_loan_id), remainingBalance.toString());
      await syncEmployeeCreditScore(employeeId, loan.employee_wallet_address);
    } catch (error) {
      console.error(`[Blockchain] Failed to sync EMI repayment for loan ${loanId}:`, error);
    }
  }

  return {
    loanId,
    status: "repaid" as const,
    amountRepaid: remainingBalance,
    txHash: transfer.txHash ?? null
  };
}
