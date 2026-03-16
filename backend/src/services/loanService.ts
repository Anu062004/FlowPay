import { db } from "../db/pool.js";
import { runLoanDecisionAgent } from "../agents/loanAgent.js";
import { sendTransaction } from "./walletService.js";
import { ApiError } from "../utils/errors.js";

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
  const result = await db.query(
    `SELECT e.id, e.salary, e.credit_score, e.wallet_id, w.wallet_address, c.treasury_wallet_id
     FROM employees e
     JOIN wallets w ON e.wallet_id = w.id
     JOIN companies c ON e.company_id = c.id
     WHERE e.id = $1`,
    [employeeId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Employee not found or missing wallet");
  }

  const employee = result.rows[0];
  const salary = parseFloat(employee.salary);
  if (requestedAmount > salary * 2) {
    throw new ApiError(400, "Requested amount exceeds max loan (2x salary)");
  }

  const decision = await runLoanDecisionAgent({
    salary,
    credit_score: employee.credit_score,
    requested_amount: requestedAmount
  }).catch(() => ({
    decision: "reject" as const,
    amount: requestedAmount,
    interest: 0,
    duration: 6
  }));

  if (decision.decision === "reject") {
    await db.query(
      "INSERT INTO loans (employee_id, amount, interest_rate, duration_months, remaining_balance, status) VALUES ($1, $2, $3, $4, $5, 'rejected')",
      [employeeId, requestedAmount, decision.interest, decision.duration, requestedAmount]
    );
    return { decision: "reject" };
  }

  if (decision.amount > salary * 2) {
    throw new ApiError(400, "Agent-approved amount exceeds policy limit");
  }

  const emi = calculateEmi(decision.amount, decision.interest, decision.duration);
  if (emi > salary * 0.3) {
    throw new ApiError(400, "EMI exceeds 30% salary policy");
  }

  const totalRepayable = emi * decision.duration;

  const loanResult = await db.query(
    "INSERT INTO loans (employee_id, amount, interest_rate, duration_months, remaining_balance, status) VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id",
    [employeeId, decision.amount, decision.interest, decision.duration, totalRepayable]
  );

  await sendTransaction(
    employee.treasury_wallet_id,
    employee.wallet_address,
    decision.amount,
    "loan_disbursement"
  );

  return {
    decision: "approve",
    loanId: loanResult.rows[0].id,
    amount: decision.amount,
    interest: decision.interest,
    duration: decision.duration,
    emi
  };
}
