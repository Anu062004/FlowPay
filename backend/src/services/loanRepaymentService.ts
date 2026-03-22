import { db } from "../db/pool.js";
import { ApiError } from "../utils/errors.js";
import { sendTransaction } from "./walletService.js";
import {
  ensureEmployeeInitializedOnCore,
  recordEmiRepaidOnCore,
  recordLoanClosureOnCore,
  repayContractEMI
} from "./contractService.js";
import { syncEmployeeCreditScore } from "./loanFlowSupport.js";

async function getRepayableLoan(loanId: string, employeeId: string) {
  const result = await db.query(
    `SELECT
       l.id,
       l.employee_id,
       l.contract_loan_id,
       l.remaining_balance,
       l.status,
       e.salary,
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
    throw new ApiError(400, "Only active loans can be repaid");
  }
  if (!loan.employee_wallet_id || !loan.employee_wallet_address || !loan.treasury_wallet_id || !loan.treasury_wallet_address) {
    throw new ApiError(400, "Loan wallets are not configured correctly");
  }
  return loan;
}

async function repayLoanAmount(loanId: string, employeeId: string, amount: number) {
  const loan = await getRepayableLoan(loanId, employeeId);
  const remainingBalance = parseFloat(loan.remaining_balance);
  if (!Number.isFinite(remainingBalance) || remainingBalance <= 0) {
    throw new ApiError(400, "Loan has no outstanding balance");
  }
  if (amount > remainingBalance + 0.0000001) {
    throw new ApiError(400, "Repayment exceeds remaining balance");
  }

  const transfer = await sendTransaction(
    loan.employee_wallet_id,
    loan.treasury_wallet_address,
    amount,
    "emi_repayment",
    loan.treasury_wallet_id
  );

  const nextRemaining = Math.max(parseFloat((remainingBalance - amount).toFixed(6)), 0);
  const nextStatus = nextRemaining <= 0 ? "repaid" : "active";
  await db.query(
    "UPDATE loans SET remaining_balance = $1, status = $2, updated_at = now() WHERE id = $3",
    [nextRemaining.toFixed(6), nextStatus, loanId]
  );

  if (loan.contract_loan_id) {
    await repayContractEMI(Number(loan.contract_loan_id), amount.toString());
  } else {
    const salary = parseFloat(loan.salary);
    if (Number.isFinite(salary) && salary > 0) {
      await ensureEmployeeInitializedOnCore(loan.employee_wallet_address, salary, 1);
      if (nextRemaining <= 0) {
        await recordLoanClosureOnCore(loan.employee_wallet_address);
      } else {
        await recordEmiRepaidOnCore(loan.employee_wallet_address);
      }
    }
  }

  const updatedScore = await syncEmployeeCreditScore(employeeId, loan.employee_wallet_address, loan.salary);
  return {
    loanId,
    status: nextStatus,
    amountRepaid: amount,
    remainingBalance: nextRemaining,
    updatedScore,
    txHash: transfer.txHash ?? null,
    message:
      nextRemaining <= 0
        ? "Loan fully repaid and score updated."
        : "EMI repayment recorded and score updated."
  };
}

export async function repayLoanEmi(loanId: string, employeeId: string, amount: number) {
  return repayLoanAmount(loanId, employeeId, amount);
}

export async function repayLoanInFull(loanId: string, employeeId: string) {
  const loan = await getRepayableLoan(loanId, employeeId);
  return repayLoanAmount(loanId, employeeId, parseFloat(loan.remaining_balance));
}
