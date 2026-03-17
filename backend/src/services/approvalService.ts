import { db } from "../db/pool.js";
import { ApiError } from "../utils/errors.js";
import { runPayroll } from "./payrollService.js";
import { executeApprovedLoan, rejectPendingLoan } from "./loanService.js";
import { updateOpsTaskStatus } from "./opsService.js";

type ApprovalRow = {
  id: string;
  company_id: string;
  task_id: string;
  kind: string;
  status: string;
  task_payload: Record<string, unknown>;
};

async function getApproval(approvalId: string): Promise<ApprovalRow> {
  const result = await db.query(
    `SELECT a.id, a.company_id, a.task_id, a.kind, a.status,
            t.payload as task_payload
     FROM ops_approvals a
     JOIN ops_tasks t ON t.id = a.task_id
     WHERE a.id = $1`,
    [approvalId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Approval request not found");
  }
  return result.rows[0];
}

export async function approveRequest(approvalId: string, decidedBy?: string, decisionPayload?: Record<string, unknown>) {
  const approval = await getApproval(approvalId);
  if (approval.status !== "pending") {
    throw new ApiError(400, "Approval request already processed");
  }

  await db.query(
    `UPDATE ops_approvals
     SET status = 'approved', decided_at = now(), decided_by = $1, decision_payload = $2
     WHERE id = $3`,
    [decidedBy ?? null, decisionPayload ?? {}, approvalId]
  );
  await updateOpsTaskStatus(approval.task_id, "approved");

  let actionResult: unknown = null;
  if (approval.kind === "payroll") {
    actionResult = await runPayroll(approval.company_id);
  } else if (approval.kind === "loan") {
    const payload = approval.task_payload ?? {};
    const loanId = (payload as any).loanId as string | undefined;
    if (!loanId) {
      throw new ApiError(400, "Loan approval missing loanId");
    }
    actionResult = await executeApprovedLoan(loanId);
  }

  return { approvalId, status: "approved", actionResult };
}

export async function denyRequest(approvalId: string, decidedBy?: string, decisionPayload?: Record<string, unknown>) {
  const approval = await getApproval(approvalId);
  if (approval.status !== "pending") {
    throw new ApiError(400, "Approval request already processed");
  }

  await db.query(
    `UPDATE ops_approvals
     SET status = 'denied', decided_at = now(), decided_by = $1, decision_payload = $2
     WHERE id = $3`,
    [decidedBy ?? null, decisionPayload ?? {}, approvalId]
  );
  await updateOpsTaskStatus(approval.task_id, "denied");

  if (approval.kind === "loan") {
    const payload = approval.task_payload ?? {};
    const loanId = (payload as any).loanId as string | undefined;
    if (loanId) {
      await rejectPendingLoan(loanId);
    }
  }

  return { approvalId, status: "denied" };
}
