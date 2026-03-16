import { db } from "../db/pool.js";
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

export async function runPayroll(companyId?: string) {
  const companyQuery = companyId
    ? "SELECT id, treasury_wallet_id FROM companies WHERE id = $1"
    : "SELECT id, treasury_wallet_id FROM companies";
  const companyParams = companyId ? [companyId] : [];
  const companies = await db.query(companyQuery, companyParams);

  if (companies.rowCount === 0) {
    throw new ApiError(404, "No companies found for payroll");
  }

  const results = [];

  for (const company of companies.rows) {
    if (!company.treasury_wallet_id) {
      continue;
    }
    const employees = await db.query(
      `SELECT e.id, e.salary, e.wallet_id, w.wallet_address
       FROM employees e
       JOIN wallets w ON e.wallet_id = w.id
       WHERE e.company_id = $1 AND e.status = 'active'`,
      [company.id]
    );

    for (const employee of employees.rows) {
      const salary = parseFloat(employee.salary);
      const loans = await db.query(
        "SELECT id, amount, interest_rate, duration_months, remaining_balance FROM loans WHERE employee_id = $1 AND status = 'active'",
        [employee.id]
      );

      let totalEmi = 0;
      for (const loan of loans.rows) {
        const emi = calculateEmi(
          parseFloat(loan.amount),
          parseFloat(loan.interest_rate),
          parseInt(loan.duration_months, 10)
        );
        totalEmi += emi;
      }

      const netSalary = Math.max(salary - totalEmi, 0);

      if (netSalary > 0) {
        await sendTransaction(
          company.treasury_wallet_id,
          employee.wallet_address,
          netSalary,
          "payroll"
        );
      }

      if (totalEmi > 0) {
        await db.query(
          "INSERT INTO transactions (wallet_id, type, amount) VALUES ($1, 'emi_repayment', $2)",
          [company.treasury_wallet_id, totalEmi.toFixed(6)]
        );
      }

      for (const loan of loans.rows) {
        const emi = calculateEmi(
          parseFloat(loan.amount),
          parseFloat(loan.interest_rate),
          parseInt(loan.duration_months, 10)
        );
        const remaining = parseFloat(loan.remaining_balance) - emi;
        if (remaining <= 0) {
          await db.query(
            "UPDATE loans SET remaining_balance = 0, status = 'repaid', updated_at = now() WHERE id = $1",
            [loan.id]
          );
        } else {
          await db.query(
            "UPDATE loans SET remaining_balance = $1, updated_at = now() WHERE id = $2",
            [remaining.toFixed(6), loan.id]
          );
        }
      }

      results.push({ employeeId: employee.id, netSalary, totalEmi });
    }
  }

  return { processed: results.length, results };
}
