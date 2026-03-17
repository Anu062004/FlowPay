import cron from "node-cron";
import { env } from "../config/env.js";
import { db } from "../db/pool.js";
import { createOpsTask } from "../services/opsService.js";
import { getTreasuryBalance } from "../services/treasuryService.js";

async function runReports() {
  const companies = await db.query("SELECT id, name FROM companies");
  for (const company of companies.rows) {
    const companyId = company.id as string;

    const employees = await db.query(
      `SELECT
         COUNT(*) AS total_employees,
         COUNT(*) FILTER (WHERE status = 'active') AS active_employees,
         COALESCE(SUM(salary), 0) AS total_salary
       FROM employees WHERE company_id = $1`,
      [companyId]
    );

    const loans = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active') AS active_loans,
         COALESCE(SUM(remaining_balance), 0) FILTER (WHERE status = 'active') AS outstanding_balance
       FROM loans l
       JOIN employees e ON e.id = l.employee_id
       WHERE e.company_id = $1`,
      [companyId]
    );

    const txs = await db.query(
      `SELECT
         COUNT(*) AS tx_count,
         COALESCE(SUM(amount), 0) AS tx_amount
       FROM transactions t
       JOIN wallets w ON t.wallet_id = w.id
       JOIN companies c ON c.treasury_wallet_id = w.id
       WHERE c.id = $1 AND t.created_at >= now() - interval '7 days'`,
      [companyId]
    );

    let treasury = null;
    try {
      treasury = await getTreasuryBalance(companyId);
    } catch {
      treasury = null;
    }

    const payload = {
      companyId,
      companyName: company.name,
      period: "last_7_days",
      employees: employees.rows[0],
      loans: loans.rows[0],
      transactions: txs.rows[0],
      treasury
    };

    try {
      await createOpsTask({
        companyId,
        type: "admin_report",
        subject: "FlowPay weekly summary",
        payload
      });
    } catch (error) {
      console.error("Failed to create admin report task", error);
    }
  }
}

export function startReportScheduler() {
  cron.schedule(env.REPORT_CRON, () => {
    runReports().catch((error) => {
      console.error("Report scheduler error", error);
    });
  });
}
