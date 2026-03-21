import { db } from "../db/pool.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/errors.js";

export type OpsTaskType =
  | "employee_invite"
  | "company_access"
  | "employee_access"
  | "company_recovery"
  | "employee_recovery"
  | "payroll_approval"
  | "payroll_prep"
  | "payroll_balance_alert"
  | "loan_approval"
  | "treasury_topup"
  | "finance_snapshot"
  | "reconciliation_report"
  | "eod_summary"
  | "settlement_alert"
  | "monitoring_alert"
  | "workflow_retry"
  | "browser_automation"
  | "notification_alert"
  | "kyc_request"
  | "contract_approval"
  | "support_ticket"
  | "admin_report";

export type OpsTaskStatus = "pending" | "sent" | "approved" | "denied" | "completed" | "cancelled";

export function parseAdminEmails(): string[] {
  const raw = env.ADMIN_EMAILS?.trim() || "";
  const emails: string[] = [];
  if (raw) {
    for (const part of raw.split(",")) {
      const value = part.trim();
      if (value) emails.push(value);
    }
  }

  if (emails.length === 0 && env.CLAWGENCY_PLATFORM_EMAIL) {
    emails.push(env.CLAWGENCY_PLATFORM_EMAIL);
  }

  if (emails.length === 0 && env.EMAIL_FROM) {
    const match = env.EMAIL_FROM.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (match) emails.push(match[0]);
  }

  return Array.from(new Set(emails));
}

export function getDefaultAdminEmail(): string | null {
  const emails = parseAdminEmails();
  return emails.length > 0 ? emails[0] : null;
}

export async function createOpsTask(input: {
  companyId: string;
  type: OpsTaskType;
  payload: Record<string, unknown>;
  recipientEmail?: string | null;
  subject?: string | null;
  approvalKind?: string | null;
}) {
  const recipient = input.recipientEmail ?? getDefaultAdminEmail();
  if (!recipient && input.type !== "employee_invite") {
    throw new ApiError(400, "No admin recipient email configured");
  }

  const taskResult = await db.query(
    `INSERT INTO ops_tasks (company_id, type, status, recipient_email, subject, payload)
     VALUES ($1, $2, 'pending', $3, $4, $5)
     RETURNING id, company_id, type, status, recipient_email, subject, payload, approval_id, created_at`,
    [input.companyId, input.type, recipient, input.subject ?? null, input.payload]
  );
  const task = taskResult.rows[0];

  let approvalId: string | null = null;
  if (input.approvalKind) {
    const approvalResult = await db.query(
      `INSERT INTO ops_approvals (company_id, task_id, kind, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id`,
      [input.companyId, task.id, input.approvalKind]
    );
    approvalId = approvalResult.rows[0].id as string;
    await db.query("UPDATE ops_tasks SET approval_id = $1 WHERE id = $2", [approvalId, task.id]);
  }

  return { task, approvalId };
}

export async function createOpsTaskIfNotRecent(input: {
  companyId: string;
  type: OpsTaskType;
  payload: Record<string, unknown>;
  recipientEmail?: string | null;
  subject?: string | null;
  approvalKind?: string | null;
  dedupeWindowMinutes?: number;
}) {
  const recipient = input.recipientEmail ?? getDefaultAdminEmail();
  const subject = input.subject ?? null;
  const dedupeWindowMinutes = Math.max(1, input.dedupeWindowMinutes ?? 60);

  const duplicate = await db.query(
    `SELECT id, approval_id
     FROM ops_tasks
     WHERE company_id = $1
       AND type = $2
       AND COALESCE(recipient_email, '') = COALESCE($3, '')
       AND COALESCE(subject, '') = COALESCE($4, '')
       AND payload = $5::jsonb
       AND created_at >= now() - ($6::text || ' minutes')::interval
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.companyId, input.type, recipient, subject, input.payload, String(dedupeWindowMinutes)]
  );

  if ((duplicate.rowCount ?? 0) > 0) {
    return {
      task: duplicate.rows[0],
      approvalId: (duplicate.rows[0].approval_id as string | null) ?? null,
      created: false
    };
  }

  const created = await createOpsTask({
    companyId: input.companyId,
    type: input.type,
    payload: input.payload,
    recipientEmail: recipient,
    subject,
    approvalKind: input.approvalKind ?? null
  });

  return { ...created, created: true };
}

export async function hasRecentOpsTask(input: {
  companyId: string;
  type: OpsTaskType;
  payload: Record<string, unknown>;
  recipientEmail?: string | null;
  subject?: string | null;
  windowMinutes?: number;
}) {
  const recipient = input.recipientEmail ?? getDefaultAdminEmail();
  const subject = input.subject ?? null;
  const windowMinutes = Math.max(1, input.windowMinutes ?? 60);

  const duplicate = await db.query(
    `SELECT 1
     FROM ops_tasks
     WHERE company_id = $1
       AND type = $2
       AND COALESCE(recipient_email, '') = COALESCE($3, '')
       AND COALESCE(subject, '') = COALESCE($4, '')
       AND payload = $5::jsonb
       AND created_at >= now() - ($6::text || ' minutes')::interval
     LIMIT 1`,
    [input.companyId, input.type, recipient, subject, input.payload, String(windowMinutes)]
  );

  return (duplicate.rowCount ?? 0) > 0;
}

export async function listOpsTasks(filters: { status?: string; companyId?: string; type?: string }) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`status = $${params.length}`);
  }
  if (filters.companyId) {
    params.push(filters.companyId);
    clauses.push(`company_id = $${params.length}`);
  }
  if (filters.type) {
    params.push(filters.type);
    clauses.push(`type = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await db.query(
    `SELECT id, company_id, type, status, recipient_email, subject, payload, approval_id, created_at, updated_at, completed_at
     FROM ops_tasks
     ${where}
     ORDER BY created_at ASC`,
    params
  );

  return result.rows;
}

export async function updateOpsTaskStatus(taskId: string, status: OpsTaskStatus) {
  const result = await db.query(
    `UPDATE ops_tasks
     SET status = $1,
         updated_at = now(),
         completed_at = CASE WHEN $1 IN ('completed', 'approved', 'denied', 'cancelled') THEN now() ELSE completed_at END
     WHERE id = $2
     RETURNING id, status, updated_at, completed_at`,
    [status, taskId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Ops task not found");
  }
  return result.rows[0];
}

export async function listApprovals(filters: { status?: string; companyId?: string }) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`a.status = $${params.length}`);
  }
  if (filters.companyId) {
    params.push(filters.companyId);
    clauses.push(`a.company_id = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await db.query(
    `SELECT a.id, a.company_id, a.task_id, a.kind, a.status, a.requested_at, a.decided_at, a.decided_by,
            a.decision_payload, t.type as task_type, t.payload as task_payload, t.recipient_email
     FROM ops_approvals a
     JOIN ops_tasks t ON t.id = a.task_id
     ${where}
     ORDER BY a.requested_at ASC`,
    params
  );

  return result.rows;
}
