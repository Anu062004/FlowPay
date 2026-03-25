import { db } from "../db/pool.js";
import { sendTransaction } from "./walletService.js";
import { ApiError } from "../utils/errors.js";
import { env } from "../config/env.js";
import { createOpsTask } from "./opsService.js";
import { getTreasuryBalance } from "./treasuryService.js";
import { logAgentAction, type AgentLogContext } from "./agentLogService.js";
import { evaluateAgentPolicy } from "./agentPolicyService.js";
import { getCompanySettings } from "./settingsService.js";
import {
  ensureEmployeeInitializedOnCore,
  getEmployeeCreditScoreOnCore,
  recordPayrollOnCore
} from "./contractService.js";
import { getCompanySettlementChain } from "./companySettlementService.js";
import { getSettlementTokenSymbol } from "../utils/settlement.js";
import {
  formatPayrollMonthKey,
  formatPayrollMonthLabel,
} from "../utils/payrollSchedule.js";

function calculateEmi(amount: number, annualInterestRate: number, durationMonths: number) {
  const monthlyRate = annualInterestRate / 100 / 12;
  if (monthlyRate === 0) {
    return amount / durationMonths;
  }
  const numerator = amount * monthlyRate * Math.pow(1 + monthlyRate, durationMonths);
  const denominator = Math.pow(1 + monthlyRate, durationMonths) - 1;
  return numerator / denominator;
}

function getPayrollMonthKey(reference = new Date(), timeZone = "UTC") {
  return formatPayrollMonthKey(reference, timeZone);
}

function getPayrollMonthLabel(reference = new Date(), timeZone = "UTC") {
  return formatPayrollMonthLabel(reference, timeZone);
}

async function getCompanyPayrollEmployees(companyId: string, payrollMonthKey: string) {
  const result = await db.query(
    `SELECT
       e.id,
       e.salary,
       e.wallet_id,
       w.wallet_address,
       pd_current.created_at AS paid_at_this_period,
       last_paid.last_payroll_at
     FROM employees e
     JOIN wallets w ON e.wallet_id = w.id
     LEFT JOIN payroll_disbursements pd_current
       ON pd_current.employee_id = e.id
      AND pd_current.company_id = e.company_id
      AND pd_current.payroll_month = $2::date
     LEFT JOIN LATERAL (
       SELECT MAX(pd.created_at) AS last_payroll_at
       FROM payroll_disbursements pd
       WHERE pd.employee_id = e.id
     ) last_paid ON true
     WHERE e.company_id = $1
       AND e.status = 'active'
     ORDER BY e.created_at ASC`,
    [companyId, payrollMonthKey]
  );

  return result.rows as Array<{
    id: string;
    salary: string;
    wallet_id: string;
    wallet_address: string;
    paid_at_this_period: string | null;
    last_payroll_at: string | null;
  }>;
}

async function tryAcquirePayrollLock(companyId: string) {
  const result = await db.query(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
    [`payroll:${companyId}`]
  );
  return Boolean(result.rows[0]?.locked);
}

async function releasePayrollLock(companyId: string) {
  await db.query("SELECT pg_advisory_unlock(hashtext($1))", [`payroll:${companyId}`]);
}

export async function getDuePayrollEmployees(companyId: string, payrollMonthKey: string) {
  const activeEmployees = await getCompanyPayrollEmployees(companyId, payrollMonthKey);
  return activeEmployees.filter((employee) => !employee.paid_at_this_period);
}

async function syncEmployeeCreditScore(companyId: string, employeeId: string, walletAddress: string) {
  const score = await getEmployeeCreditScoreOnCore(companyId, walletAddress);
  await db.query("UPDATE employees SET credit_score = $1 WHERE id = $2", [score, employeeId]);
  return score;
}

export async function runPayroll(
  companyId?: string,
  auditContext: AgentLogContext = {},
  options?: {
    payrollMonthKey?: string;
    payrollMonthLabel?: string;
    emiAutoDeduction?: boolean;
  }
) {
  const companyQuery = companyId
    ? "SELECT id, treasury_wallet_id FROM companies WHERE id = $1"
    : "SELECT id, treasury_wallet_id FROM companies";
  const companyParams = companyId ? [companyId] : [];
  const companies = await db.query(companyQuery, companyParams);
  const referenceDate = new Date();

  if (companies.rowCount === 0) {
    throw new ApiError(404, "No companies found for payroll");
  }

  let responsePayrollMonthKey = options?.payrollMonthKey ?? getPayrollMonthKey(referenceDate);
  let responsePayrollMonthLabel = options?.payrollMonthLabel ?? getPayrollMonthLabel(referenceDate);
  const results = [];
  const companySummaries: Array<{
    companyId: string;
    payrollMonth: string;
    payrollMonthLabel: string;
    activeEmployees: number;
    eligibleEmployees: number;
    alreadyPaidEmployees: number;
    processedEmployees: number;
    totalNetSalary: number;
  }> = [];

  for (const company of companies.rows) {
    if (!company.treasury_wallet_id) {
      continue;
    }
    const companySettings = await getCompanySettings(company.id);
    const payrollMonthKey =
      options?.payrollMonthKey ?? getPayrollMonthKey(referenceDate, companySettings.profile.timeZone);
    const payrollMonthLabel =
      options?.payrollMonthLabel ?? getPayrollMonthLabel(referenceDate, companySettings.profile.timeZone);
    responsePayrollMonthKey = payrollMonthKey;
    responsePayrollMonthLabel = payrollMonthLabel;
    const emiAutoDeduction = options?.emiAutoDeduction ?? companySettings.payroll.emiAutoDeduction;
    const locked = await tryAcquirePayrollLock(company.id);

    if (!locked) {
      if (companyId) {
        throw new ApiError(409, "Payroll is already running for this company");
      }
      continue;
    }

    try {
      const settlementChain = await getCompanySettlementChain(company.id);
      const treasuryCurrency = getSettlementTokenSymbol(settlementChain);
      const activeEmployees = await getCompanyPayrollEmployees(company.id, payrollMonthKey);
      const dueEmployees = activeEmployees.filter((employee) => !employee.paid_at_this_period);
      const alreadyPaidEmployees = activeEmployees.length - dueEmployees.length;

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

      for (const employee of dueEmployees) {
        const salary = parseFloat(employee.salary);
        await ensureEmployeeInitializedOnCore(company.id, employee.wallet_address, salary, 1);
        const loans = await db.query(
          "SELECT id, amount, interest_rate, duration_months, remaining_balance FROM loans WHERE employee_id = $1 AND status = 'active'",
          [employee.id]
        );

        let totalEmi = 0;
        if (emiAutoDeduction) {
          for (const loan of loans.rows) {
            const emi = calculateEmi(
              parseFloat(loan.amount),
              parseFloat(loan.interest_rate),
              parseInt(loan.duration_months, 10)
            );
            totalEmi += emi;
          }
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

      if (employeePayrolls.length === 0) {
        companySummaries.push({
          companyId: company.id,
          payrollMonth: payrollMonthKey,
          payrollMonthLabel,
          activeEmployees: activeEmployees.length,
          eligibleEmployees: 0,
          alreadyPaidEmployees,
          processedEmployees: 0,
          totalNetSalary: 0
        });
        continue;
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
        let payrollTxHash: string | null = null;
        if (employee.netSalary > 0) {
          const transfer = await sendTransaction(
            company.treasury_wallet_id,
            employee.walletAddress,
            employee.netSalary,
            "payroll",
            employee.walletId
          );
          payrollTxHash = transfer.txHash ?? null;
          txHashes.push({
            employeeId: employee.employeeId,
            txHash: payrollTxHash
          });
        }

        try {
          await recordPayrollOnCore(company.id, employee.walletAddress);
          await syncEmployeeCreditScore(company.id, employee.employeeId, employee.walletAddress);
        } catch (error) {
          console.error("[Blockchain] Failed to sync payroll to FlowPayCore", {
            companyId: company.id,
            employeeId: employee.employeeId,
            error
          });
        }

        if (employee.totalEmi > 0) {
          const createdAt = new Date();
          await db.query(
            "INSERT INTO transactions (wallet_id, type, amount, tx_hash, token_symbol, chain, created_at) VALUES ($1, 'emi_repayment', $2, $3, $4, $5, $6)",
            [company.treasury_wallet_id, employee.totalEmi.toFixed(6), payrollTxHash, treasuryCurrency, settlementChain, createdAt]
          );
          await db.query(
            "INSERT INTO transactions (wallet_id, type, amount, tx_hash, token_symbol, chain, created_at) VALUES ($1, 'emi_repayment', $2, $3, $4, $5, $6)",
            [employee.walletId, employee.totalEmi.toFixed(6), payrollTxHash, treasuryCurrency, settlementChain, createdAt]
          );
        }

        if (emiAutoDeduction) {
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
        }

        await db.query(
          `INSERT INTO payroll_disbursements
             (company_id, employee_id, payroll_month, gross_salary, net_salary, emi_deducted, tx_hash)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7)
           ON CONFLICT (company_id, employee_id, payroll_month) DO NOTHING`,
          [
            company.id,
            employee.employeeId,
            payrollMonthKey,
            (employee.netSalary + employee.totalEmi).toFixed(6),
            employee.netSalary.toFixed(6),
            employee.totalEmi.toFixed(6),
            payrollTxHash
          ]
        );

        results.push({ employeeId: employee.employeeId, netSalary: employee.netSalary, totalEmi: employee.totalEmi });
      }

      companySummaries.push({
        companyId: company.id,
        payrollMonth: payrollMonthKey,
        payrollMonthLabel,
        activeEmployees: activeEmployees.length,
        eligibleEmployees: dueEmployees.length,
        alreadyPaidEmployees,
        processedEmployees: employeePayrolls.length,
        totalNetSalary
      });

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
    } finally {
      await releasePayrollLock(company.id);
    }
  }

  return {
    processed: results.length,
    payrollMonth: responsePayrollMonthKey,
    payrollMonthLabel: responsePayrollMonthLabel,
    companySummaries,
    results
  };
}

export async function requestPayrollApproval(
  companyId?: string,
  options?: {
    payrollMonthKey?: string;
    payrollMonthLabel?: string;
  }
) {
  const companyQuery = companyId
    ? "SELECT id, treasury_wallet_id FROM companies WHERE id = $1"
    : "SELECT id, treasury_wallet_id FROM companies";
  const companyParams = companyId ? [companyId] : [];
  const companies = await db.query(companyQuery, companyParams);

  if (companies.rowCount === 0) {
    throw new ApiError(404, "No companies found for payroll");
  }

  const approvals: Array<Record<string, unknown>> = [];
  const referenceDate = new Date();

  for (const company of companies.rows) {
    if (!company.treasury_wallet_id) {
      continue;
    }
    const companySettings = await getCompanySettings(company.id);
    const payrollMonthKey =
      options?.payrollMonthKey ?? getPayrollMonthKey(referenceDate, companySettings.profile.timeZone);
    const payrollMonthLabel =
      options?.payrollMonthLabel ?? getPayrollMonthLabel(referenceDate, companySettings.profile.timeZone);

    const existing = await db.query(
      "SELECT 1 FROM ops_approvals WHERE company_id = $1 AND kind = 'payroll' AND status = 'pending' LIMIT 1",
      [company.id]
    );
    if ((existing.rowCount ?? 0) > 0) {
      approvals.push({ companyId: company.id, status: "pending_exists" });
      continue;
    }

    const employees = await getCompanyPayrollEmployees(company.id, payrollMonthKey);
    const eligibleEmployees = employees.filter((employee) => !employee.paid_at_this_period);
    const activeCount = employees.length;
    const eligibleCount = eligibleEmployees.length;
    const totalSalary = eligibleEmployees.reduce((sum, employee) => sum + parseFloat(employee.salary), 0);

    if (activeCount === 0 || eligibleCount === 0 || totalSalary <= 0) {
      approvals.push({
        companyId: company.id,
        status: activeCount === 0 ? "no_active_employees" : "all_paid_this_month",
        payrollMonth: payrollMonthKey,
        payrollMonthLabel
      });
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
      eligibleEmployees: eligibleCount,
      alreadyPaidEmployees: activeCount - eligibleCount,
      totalSalary,
      treasuryBalance,
      treasuryAddress,
      shortfall,
      payrollMonth: payrollMonthKey,
      payrollMonthLabel,
      currency: treasuryBalance > 0
        ? (await getTreasuryBalance(company.id)).token_symbol ?? "USDT"
        : getSettlementTokenSymbol(await getCompanySettlementChain(company.id)),
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
