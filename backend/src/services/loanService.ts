import { db } from "../db/pool.js";
import { runLoanDecisionAgent } from "../agents/loanAgent.js";
import { sendTransaction } from "./walletService.js";
import { ApiError } from "../utils/errors.js";
import { getEthPrice } from "./priceService.js";
import { issueContractLoan } from "./contractService.js";
import { logAgentAction } from "./agentLogService.js";
import { getCompanySettings } from "./settingsService.js";
import { createOpsTask } from "./opsService.js";
import { env } from "../config/env.js";

function calculateEmi(amount: number, annualInterestRate: number, durationMonths: number) {
  const monthlyRate = annualInterestRate / 100 / 12;
  if (monthlyRate === 0) {
    return amount / durationMonths;
  }
  const numerator = amount * monthlyRate * Math.pow(1 + monthlyRate, durationMonths);
  const denominator = Math.pow(1 + monthlyRate, durationMonths) - 1;
  return numerator / denominator;
}

export async function requestLoan(employeeId: string, requestedAmount: number) {
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
  const salary = parseFloat(employee.salary);
  if (requestedAmount > salary * 2) {
    throw new ApiError(400, "Requested amount exceeds max loan (2x salary)");
  }

  // 2. Agent Decision
  const agentInput = {
    salary,
    credit_score: employee.credit_score,
    requested_amount: requestedAmount,
    eth_price_usd: ethPrice,
    price_change_24h: changePct
  };

  const decision = await runLoanDecisionAgent(agentInput).catch((err) => ({
    decision: "reject" as const,
    amount: requestedAmount,
    interest: 0,
    duration: 6,
    rationale: `Agent error: ${err.message}`
  }));

  // Log Agent Decision
  await logAgentAction(
    "LoanDecisionAgent",
    agentInput,
    decision,
    decision.rationale,
    decision.decision === "approve" 
      ? `Approved loan of ${decision.amount} ETH` 
      : `Rejected loan request of ${requestedAmount} ETH`,
    employee.company_id
  );

  if (decision.decision === "reject") {
    await db.query(
      "INSERT INTO loans (employee_id, amount, interest_rate, duration_months, remaining_balance, status) VALUES ($1, $2, $3, $4, $5, 'rejected')",
      [employeeId, requestedAmount, decision.interest, decision.duration, requestedAmount]
    );
    return { decision: "reject", rationale: decision.rationale };
  }

  // 3. Validation & EMI
  if (decision.amount > salary * 2) {
    throw new ApiError(400, "Agent-approved amount exceeds policy limit");
  }

  const emi = calculateEmi(decision.amount, decision.interest, decision.duration);
  if (emi > salary * 0.3) {
    throw new ApiError(400, "EMI exceeds 30% salary policy");
  }

  const totalRepayable = emi * decision.duration;

  // 4. Execution
  const autoThreshold = parseFloat(env.LOAN_AUTO_APPROVAL_THRESHOLD || "0.02");

  const loanResult = await db.query(
    "INSERT INTO loans (employee_id, amount, interest_rate, duration_months, remaining_balance, status, contract_synced) VALUES ($1, $2, $3, $4, $5, $6, false) RETURNING id",
    [
      employeeId,
      decision.amount,
      decision.interest,
      decision.duration,
      totalRepayable,
      decision.amount <= autoThreshold ? "active" : "pending"
    ]
  );

  const loanId = loanResult.rows[0].id as string;

  if (decision.amount <= autoThreshold) {
    try {
      await sendTransaction(
        employee.treasury_wallet_id,
        employee.wallet_address,
        decision.amount,
        "loan_disbursement"
      );

      issueContractLoan(
        employee.wallet_address,
        decision.amount.toString(),
        decision.interest,
        decision.duration
      )
        .then(async () => {
          await db.query("UPDATE loans SET contract_synced = true WHERE id = $1", [loanId]);
          console.log(`[Blockchain] Successfully synced loan ${loanId} to contract`);
        })
        .catch(err => {
          console.error(`[Blockchain] Failed to sync loan ${loanId} to contract:`, err.message);
        });
    } catch (error) {
      await db.query("UPDATE loans SET status = 'rejected' WHERE id = $1", [loanId]);
      throw error;
    }

    return {
      decision: "approve",
      loanId,
      amount: decision.amount,
      interest: decision.interest,
      duration: decision.duration,
      emi,
      rationale: decision.rationale,
      autoApproved: true
    };
  }

  const payload = {
    companyId: employee.company_id,
    employeeId: employee.id,
    employeeName: employee.full_name,
    employeeEmail: employee.email,
    loanId,
    amount: decision.amount,
    interest: decision.interest,
    duration: decision.duration,
    emi,
    rationale: decision.rationale,
    autoApprovalThreshold: autoThreshold
  };

  const { approvalId } = await createOpsTask({
    companyId: employee.company_id,
    type: "loan_approval",
    subject: `FlowPay loan approval required for ${employee.full_name}`,
    payload,
    approvalKind: "loan"
  });

  return {
    decision: "pending_approval",
    loanId,
    approvalId,
    amount: decision.amount,
    interest: decision.interest,
    duration: decision.duration,
    emi,
    rationale: decision.rationale
  };
}

export async function executeApprovedLoan(loanId: string) {
  const result = await db.query(
    `SELECT l.id, l.amount, l.interest_rate, l.duration_months, l.status,
            e.id as employee_id, e.company_id, w.wallet_address, c.treasury_wallet_id
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

  await sendTransaction(
    row.treasury_wallet_id,
    row.wallet_address,
    parseFloat(row.amount),
    "loan_disbursement"
  );

  issueContractLoan(
    row.wallet_address,
    row.amount.toString(),
    parseFloat(row.interest_rate),
    parseInt(row.duration_months, 10)
  )
    .then(async () => {
      await db.query("UPDATE loans SET contract_synced = true WHERE id = $1", [loanId]);
      console.log(`[Blockchain] Successfully synced loan ${loanId} to contract`);
    })
    .catch(err => {
      console.error(`[Blockchain] Failed to sync loan ${loanId} to contract:`, err.message);
    });

  await db.query("UPDATE loans SET status = 'active', updated_at = now() WHERE id = $1", [loanId]);

  return { loanId, status: "active" };
}

export async function rejectPendingLoan(loanId: string) {
  await db.query("UPDATE loans SET status = 'rejected', updated_at = now() WHERE id = $1", [loanId]);
  return { loanId, status: "rejected" };
}
