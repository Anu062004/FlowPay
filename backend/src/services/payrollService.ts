import { db } from "../db/pool.js";
import { sendTransaction } from "./walletService.js";
import { ApiError } from "../utils/errors.js";
import { env } from "../config/env.js";
import { createOpsTask } from "./opsService.js";
import { getTreasuryBalance } from "./treasuryService.js";
import { logAgentAction, type AgentLogContext } from "./agentLogService.js";
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

export async function runPayroll(companyId?: string, auditContext: AgentLogContext = {}) {
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

    const employeePayrolls: Array<{
      employeeId: string;
      walletAddress: string;
      walletId: string;
      netSalary: number;
      totalEmi: number;
      loanRows: Array<any>;
    }> = [];

    let totalNetSalary = 0;
    let totalEmiCollected = 0;

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
      totalNetSalary += netSalary;
      totalEmiCollected += totalEmi;

      employeePayrolls.push({
        employeeId: employee.id,
        walletAddress: employee.wallet_address,
        walletId: employee.wallet_id,
        netSalary,
        totalEmi,
        loanRows: loans.rows
      });
    }

    const policyResult = await evaluateAgentPolicy({
      companyId: company.id,
      action: "payroll",
      amount: totalNetSalary
    });

    await logAgentAction(
      "FlowPayPolicyEngine",
      {
        companyId: company.id,
        employees: employeePayrolls.length,
        totalNetSalary,
        totalEmiCollected
      },
      {
        action: "payroll"
      },
      policyResult.reasons.join(" ") || "Payroll run passed wallet policy checks.",
      `Payroll policy status: ${policyResult.status.toUpperCase()}`,
      company.id,
      {
        ...auditContext,
        stage: "policy_validation",
        policyResult,
        executionStatus: policyResult.status
      }
    );

    if (policyResult.status === "block") {
      throw new ApiError(400, policyResult.reasons[0] ?? "Payroll blocked by wallet policy");
    }

    const txHashes: Array<{ employeeId: string; txHash: string | null }> = [];

    try {
      for (const employee of employeePayrolls) {
        if (employee.netSalary > 0) {
          const transfer = await sendTransaction(
            company.treasury_wallet_id,
            employee.walletAddress,
            employee.netSalary,
            "payroll",
            employee.walletId
          );
          txHashes.push({
            employeeId: employee.employeeId,
            txHash: transfer.txHash ?? null
          });
        }

        if (employee.totalEmi > 0) {
          const tokenSymbol = env.TREASURY_TOKEN_SYMBOL ?? "ETH";
          const createdAt = new Date();
          await db.query(
            "INSERT INTO transactions (wallet_id, type, amount, token_symbol, created_at) VALUES ($1, 'emi_repayment', $2, $3, $4)",
            [company.treasury_wallet_id, employee.totalEmi.toFixed(6), tokenSymbol, createdAt]
          );
          await db.query(
            "INSERT INTO transactions (wallet_id, type, amount, token_symbol, created_at) VALUES ($1, 'emi_repayment', $2, $3, $4)",
            [employee.walletId, employee.totalEmi.toFixed(6), tokenSymbol, createdAt]
          );
        }

        for (const loan of employee.loanRows) {
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

        results.push({ employeeId: employee.employeeId, netSalary: employee.netSalary, totalEmi: employee.totalEmi });
      }

      await logAgentAction(
        "WDKExecutionLayer",
        {
          companyId: company.id,
          employees: employeePayrolls.length,
          totalNetSalary,
          totalEmiCollected
        },
        {
          action: "payroll"
        },
        "Payroll transfers executed and EMI deductions recorded.",
        `Payroll execution completed for ${employeePayrolls.length} employees.`,
        company.id,
        {
          ...auditContext,
          stage: "wdk_execution",
          policyResult,
          executionStatus: "success",
          metadata: {
            txHashes
          }
        }
      );
    } catch (error) {
      await logAgentAction(
        "WDKExecutionLayer",
        {
          companyId: company.id,
          employees: employeePayrolls.length,
          totalNetSalary,
          totalEmiCollected
        },
        {
          action: "payroll"
        },
        error instanceof Error ? error.message : "Payroll execution failed.",
        "Payroll execution failed.",
        company.id,
        {
          ...auditContext,
          stage: "wdk_execution",
          policyResult,
          executionStatus: "failed",
          metadata: {
            txHashes
          }
        }
      );
      throw error;
    }
  }

  return { processed: results.length, results };
}

export async function requestPayrollApproval(companyId?: string) {
  const companyQuery = companyId
    ? "SELECT id, treasury_wallet_id FROM companies WHERE id = $1"
    : "SELECT id, treasury_wallet_id FROM companies";
  const companyParams = companyId ? [companyId] : [];
  const companies = await db.query(companyQuery, companyParams);

  if (companies.rowCount === 0) {
    throw new ApiError(404, "No companies found for payroll");
  }

  const approvals: Array<Record<string, unknown>> = [];

  for (const company of companies.rows) {
    if (!company.treasury_wallet_id) {
      continue;
    }

    const existing = await db.query(
      "SELECT 1 FROM ops_approvals WHERE company_id = $1 AND kind = 'payroll' AND status = 'pending' LIMIT 1",
      [company.id]
    );
    if ((existing.rowCount ?? 0) > 0) {
      approvals.push({ companyId: company.id, status: "pending_exists" });
      continue;
    }

    const employees = await db.query(
      "SELECT COUNT(*) AS active_count, COALESCE(SUM(salary), 0) AS total_salary FROM employees WHERE company_id = $1 AND status = 'active'",
      [company.id]
    );
    const activeCount = parseInt(employees.rows[0].active_count, 10);
    const totalSalary = parseFloat(employees.rows[0].total_salary);

    if (activeCount === 0 || totalSalary <= 0) {
      approvals.push({ companyId: company.id, status: "no_active_employees" });
      continue;
    }

    let treasuryBalance = 0;
    let treasuryAddress: string | null = null;
    try {
      const balance = await getTreasuryBalance(company.id);
      treasuryBalance = parseFloat(balance.balance);
      treasuryAddress = balance.wallet_address ?? null;
    } catch {
      treasuryBalance = 0;
    }

    const shortfall = Math.max(totalSalary - treasuryBalance, 0);
    const payload = {
      companyId: company.id,
      activeEmployees: activeCount,
      totalSalary,
      treasuryBalance,
      treasuryAddress,
      shortfall,
      currency: env.TREASURY_TOKEN_SYMBOL ?? "ETH",
      requestedAt: new Date().toISOString()
    };

    const { task, approvalId } = await createOpsTask({
      companyId: company.id,
      type: "payroll_approval",
      subject: "FlowPay payroll approval required",
      payload,
      approvalKind: "payroll"
    });

    approvals.push({ companyId: company.id, taskId: task.id, approvalId, status: "pending" });
  }

  return { requested: approvals.length, approvals };
}
