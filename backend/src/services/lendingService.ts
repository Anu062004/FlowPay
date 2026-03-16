import { db } from "../db/pool.js";

export async function getLendingHistory(companyId: string) {
  const totals = await db.query(
    `SELECT
        COUNT(*) FILTER (WHERE l.status = 'active') as active_loans,
        COUNT(*) as total_loans,
        COALESCE(SUM(l.amount), 0) as total_issued,
        COALESCE(SUM(l.remaining_balance), 0) as remaining_balance
     FROM loans l
     JOIN employees e ON l.employee_id = e.id
     WHERE e.company_id = $1`,
    [companyId]
  );

  const history = await db.query(
    `SELECT l.id, e.full_name, e.email, l.amount, l.remaining_balance, l.interest_rate, l.duration_months, l.status, l.created_at
     FROM loans l
     JOIN employees e ON l.employee_id = e.id
     WHERE e.company_id = $1
     ORDER BY l.created_at DESC`,
    [companyId]
  );

  return {
    summary: totals.rows[0],
    loans: history.rows
  };
}
