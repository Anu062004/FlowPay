import { db } from "../db/pool.js";

export type FailureInsight = {
  timestamp: string;
  agent_name: string;
  action_taken: string;
  rationale: string | null;
};

export type PendingApprovalInsight = {
  id: string;
  kind: string;
  task_type: string;
  requested_at: string;
  company_id: string;
};

export type RiskAccountInsight = {
  employee_id: string;
  full_name: string;
  email: string;
  company_id: string;
  credit_score: number;
  salary: number;
  active_loan_balance: number;
  active_loan_count: number;
  overdue_loan_count: number;
  risk_score: number;
};

export type AdminSupportInsights = {
  companyId?: string;
  generatedAt: string;
  failuresToday: {
    count: number;
    items: FailureInsight[];
  };
  pendingApprovals: {
    count: number;
    items: PendingApprovalInsight[];
  };
  topRiskAccounts: RiskAccountInsight[];
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

export async function getAdminSupportInsights(companyId?: string): Promise<AdminSupportInsights> {
  const companyClause = companyId ? "AND l.company_id = $1" : "";
  const companyClauseApprovals = companyId ? "AND a.company_id = $1" : "";
  const companyClauseEmployees = companyId ? "AND e.company_id = $1" : "";
  const params = companyId ? [companyId] : [];

  const failuresResult = await db.query(
    `SELECT l.timestamp, l.agent_name, l.action_taken, l.rationale
     FROM agent_logs l
     WHERE l.timestamp >= date_trunc('day', now())
       ${companyClause}
       AND (
         UPPER(COALESCE(l.action_taken, '')) LIKE '%FAIL%'
         OR UPPER(COALESCE(l.action_taken, '')) LIKE '%ERROR%'
         OR UPPER(COALESCE(l.action_taken, '')) LIKE '%CRITICAL%'
         OR UPPER(COALESCE(l.rationale, '')) LIKE '%FAIL%'
         OR UPPER(COALESCE(l.rationale, '')) LIKE '%ERROR%'
         OR UPPER(COALESCE(l.rationale, '')) LIKE '%CRITICAL%'
       )
     ORDER BY l.timestamp DESC
     LIMIT 25`,
    params
  );

  const approvalsResult = await db.query(
    `SELECT a.id, a.kind, t.type AS task_type, a.requested_at, a.company_id
     FROM ops_approvals a
     JOIN ops_tasks t ON t.id = a.task_id
     WHERE a.status = 'pending'
       ${companyClauseApprovals}
     ORDER BY a.requested_at ASC
     LIMIT 50`,
    params
  );

  const risksResult = await db.query(
    `SELECT
       e.id AS employee_id,
       e.full_name,
       e.email,
       e.company_id,
       e.credit_score,
       e.salary,
       COALESCE(SUM(CASE WHEN l.status = 'active' THEN l.remaining_balance ELSE 0 END), 0) AS active_loan_balance,
       COUNT(*) FILTER (WHERE l.status = 'active') AS active_loan_count,
       COUNT(*) FILTER (
         WHERE l.status = 'active'
           AND l.created_at < now() - (l.duration_months * interval '1 month')
           AND l.remaining_balance > 0
       ) AS overdue_loan_count
     FROM employees e
     LEFT JOIN loans l ON l.employee_id = e.id
     WHERE e.status = 'active'
       ${companyClauseEmployees}
     GROUP BY e.id, e.full_name, e.email, e.company_id, e.credit_score, e.salary`,
    params
  );

  const riskAccounts = risksResult.rows
    .map((row) => {
      const salary = Math.max(toNumber(row.salary), 0.000001);
      const activeLoanBalance = Math.max(toNumber(row.active_loan_balance), 0);
      const creditScore = toNumber(row.credit_score);
      const overdueLoanCount = toNumber(row.overdue_loan_count);
      const activeLoanCount = toNumber(row.active_loan_count);
      const burdenRatio = activeLoanBalance / salary;
      const creditPenalty = Math.max(0, (700 - creditScore) / 700);
      const overduePenalty = overdueLoanCount * 0.75;
      const riskScore = burdenRatio + creditPenalty + overduePenalty;

      return {
        employee_id: row.employee_id as string,
        full_name: row.full_name as string,
        email: row.email as string,
        company_id: row.company_id as string,
        credit_score: creditScore,
        salary,
        active_loan_balance: activeLoanBalance,
        active_loan_count: activeLoanCount,
        overdue_loan_count: overdueLoanCount,
        risk_score: parseFloat(riskScore.toFixed(4))
      };
    })
    .sort((a, b) => b.risk_score - a.risk_score)
    .slice(0, 5);

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    failuresToday: {
      count: failuresResult.rowCount ?? 0,
      items: failuresResult.rows as FailureInsight[]
    },
    pendingApprovals: {
      count: approvalsResult.rowCount ?? 0,
      items: approvalsResult.rows as PendingApprovalInsight[]
    },
    topRiskAccounts: riskAccounts
  };
}

export function answerAdminSupportQuestion(
  insights: AdminSupportInsights,
  question: string
): { answer: string; data: unknown } {
  const normalized = question.trim().toLowerCase();

  if (normalized.includes("fail")) {
    const count = insights.failuresToday.count;
    const answer =
      count === 0
        ? "No failures detected today."
        : `${count} failures detected today.`;
    return { answer, data: insights.failuresToday };
  }

  if (normalized.includes("pending approval") || normalized.includes("approval")) {
    const count = insights.pendingApprovals.count;
    const answer =
      count === 0
        ? "No pending approvals."
        : `${count} approvals are pending.`;
    return { answer, data: insights.pendingApprovals };
  }

  if (normalized.includes("risk")) {
    const count = insights.topRiskAccounts.length;
    const answer =
      count === 0
        ? "No high-risk employee accounts found."
        : `Top ${count} risk accounts computed.`;
    return { answer, data: insights.topRiskAccounts };
  }

  return {
    answer:
      "Supported questions: what failed today, show pending approvals, and top risk accounts.",
    data: insights
  };
}
