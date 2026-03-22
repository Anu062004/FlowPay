import { db } from "../db/pool.js";
import { createOpsTask } from "./opsService.js";
import { sendLoanReviewStatusEmail } from "./emailService.js";
import { ApiError } from "../utils/errors.js";
import type { RepaymentMetrics } from "./loanFlowSupport.js";

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function syncLoanReviewWorkflowState(input: {
  loanId: string;
  taskStatus: "approved" | "denied" | "cancelled";
  approvalStatus?: "approved" | "denied";
  decidedBy?: string | null;
  decisionPayload?: Record<string, unknown>;
}) {
  const taskRows = await db.query(
    `SELECT id, approval_id
     FROM ops_tasks
     WHERE type = 'loan_approval'
       AND payload->>'loanId' = $1`,
    [input.loanId]
  );

  for (const row of taskRows.rows) {
    await db.query(
      `UPDATE ops_tasks
       SET status = $1,
           updated_at = now(),
           completed_at = now()
       WHERE id = $2`,
      [input.taskStatus, row.id]
    );

    if (row.approval_id && input.approvalStatus) {
      await db.query(
        `UPDATE ops_approvals
         SET status = $1,
             decided_at = now(),
             decided_by = COALESCE($2, decided_by),
             decision_payload = decision_payload || $3::jsonb
         WHERE id = $4`,
        [
          input.approvalStatus,
          input.decidedBy ?? null,
          JSON.stringify(input.decisionPayload ?? {}),
          row.approval_id
        ]
      );
    }
  }
}

export async function createLoanReviewTask(input: {
  loanId: string;
  companyId: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string | null;
  amount: number;
  interest: number;
  duration: number;
  emi: number;
  rationale: string;
  tierLabel: string;
  repaymentMetrics: RepaymentMetrics;
  policyResult: Record<string, unknown>;
}) {
  return createOpsTask({
    companyId: input.companyId,
    type: "loan_approval",
    subject: "FlowPay loan review required",
    approvalKind: "loan",
    payload: {
      loanId: input.loanId,
      employeeId: input.employeeId,
      employeeName: input.employeeName,
      employeeEmail: input.employeeEmail,
      amount: parseFloat(input.amount.toFixed(6)),
      interest: input.interest,
      duration: input.duration,
      emi: parseFloat(input.emi.toFixed(6)),
      rationale: input.rationale,
      tierLabel: input.tierLabel,
      repaymentRate: parseFloat(input.repaymentMetrics.repaymentRate.toFixed(4)),
      avgDaysToClose: parseFloat(input.repaymentMetrics.avgDaysToClose.toFixed(2)),
      missedEmiCount: input.repaymentMetrics.missedEmiCount,
      policyResult: input.policyResult,
      reviewRequestedAt: new Date().toISOString()
    }
  });
}

export async function expirePendingReviewLoans(companyId?: string) {
  const params: unknown[] = [];
  const companyClause = companyId ? "AND e.company_id = $1" : "";
  if (companyId) {
    params.push(companyId);
  }

  const expired = await db.query(
    `UPDATE loans l
     SET status = 'expired',
         updated_at = now(),
         review_reason = COALESCE(review_reason, 'Loan review expired after 48 hours')
     FROM employees e
     WHERE l.employee_id = e.id
       AND l.status = 'pending_review'
       AND l.review_expires_at IS NOT NULL
       AND l.review_expires_at <= now()
       ${companyClause}
     RETURNING l.id,
               l.amount,
               l.review_reason,
               e.company_id,
               e.id AS employee_id,
               e.full_name,
               e.email`,
    params
  );

  for (const row of expired.rows) {
    await syncLoanReviewWorkflowState({
      loanId: row.id,
      taskStatus: "cancelled",
      approvalStatus: "denied",
      decidedBy: "system-expiry",
      decisionPayload: { reason: "review_window_expired" }
    });

    if (row.email) {
      await sendLoanReviewStatusEmail({
        companyId: row.company_id,
        email: row.email,
        employeeId: row.employee_id,
        employeeName: row.full_name,
        amount: toNumber(row.amount),
        status: "expired",
        reason: row.review_reason
      }).catch((error) => {
        console.warn("Failed to send loan expiry email", error);
      });
    }
  }

  return { expired: expired.rowCount ?? 0, loans: expired.rows };
}

export async function listPendingReviewLoans(companyId: string) {
  await expirePendingReviewLoans(companyId);

  const result = await db.query(
    `SELECT
       l.id,
       l.amount,
       l.interest_rate,
       l.duration_months,
       l.remaining_balance,
       l.review_requested_at,
       l.review_expires_at,
       l.review_reason,
       e.id AS employee_id,
       e.full_name,
       COALESCE(e.email, '') AS email,
       e.salary
     FROM loans l
     JOIN employees e ON e.id = l.employee_id
     WHERE e.company_id = $1
       AND l.status = 'pending_review'
     ORDER BY l.review_requested_at ASC NULLS LAST, l.created_at ASC`,
    [companyId]
  );

  return {
    loans: result.rows.map((row) => ({
      ...row,
      expires_in_hours: row.review_expires_at
        ? parseFloat((((new Date(row.review_expires_at).getTime() - Date.now()) / 3600000)).toFixed(2))
        : null
    }))
  };
}

export async function rejectPendingReviewLoan(loanId: string, companyId: string, reason?: string) {
  const result = await db.query(
    `UPDATE loans l
     SET status = 'rejected',
         updated_at = now(),
         review_reason = COALESCE($3, l.review_reason, 'Loan rejected during HR review')
     FROM employees e
     WHERE l.employee_id = e.id
       AND l.id = $1
       AND e.company_id = $2
       AND l.status = 'pending_review'
     RETURNING l.id,
               l.amount,
               l.review_reason,
               e.company_id,
               e.id AS employee_id,
               e.full_name,
               e.email`,
    [loanId, companyId, reason ?? null]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Pending review loan not found");
  }

  const row = result.rows[0];
  await syncLoanReviewWorkflowState({
    loanId,
    taskStatus: "denied",
    approvalStatus: "denied",
    decidedBy: "company-review",
    decisionPayload: { reason: row.review_reason }
  });

  if (row.email) {
    await sendLoanReviewStatusEmail({
      companyId: row.company_id,
      email: row.email,
      employeeId: row.employee_id,
      employeeName: row.full_name,
      amount: toNumber(row.amount),
      status: "rejected",
      reason: row.review_reason
    }).catch((error) => {
      console.warn("Failed to send loan rejection email", error);
    });
  }

  return { loanId, status: "rejected" as const };
}
