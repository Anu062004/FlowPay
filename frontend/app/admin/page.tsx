"use client";
import { useEffect, useMemo, useState } from "react";
import { loadCompanyContext } from "../lib/companyContext";
import { apiFetch } from "../lib/api";

type OpsTask = {
  id: string;
  company_id: string;
  type: string;
  status: string;
  recipient_email?: string | null;
  subject?: string | null;
  payload?: Record<string, any>;
  approval_id?: string | null;
  created_at?: string;
};

type OpsApproval = {
  id: string;
  company_id: string;
  task_id: string;
  kind: string;
  status: string;
  requested_at?: string;
  decided_at?: string | null;
  decided_by?: string | null;
  decision_payload?: Record<string, any>;
  task_type?: string;
  task_payload?: Record<string, any>;
  recipient_email?: string | null;
};

type AgentLog = {
  id: string;
  timestamp: string;
  agent_name: string;
  decision: any;
  rationale: string;
  action_taken: string;
  company_id: string | null;
};

type Health = { status: string };

const STATUS_BADGE: Record<string, string> = {
  pending: "warning",
  sent: "info",
  approved: "success",
  denied: "danger",
  completed: "neutral",
  cancelled: "neutral",
};

const TASK_TYPES = [
  "payroll_approval",
  "loan_approval",
  "employee_invite",
  "treasury_topup",
  "admin_report",
  "contract_approval",
  "kyc_request",
  "support_ticket",
];

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const Icons = {
  refresh: "M4.05 11a8 8 0 0115.9 0M4.05 11H2m2.05 0l1.5-1.5M19.95 13a8 8 0 01-15.9 0M19.95 13H22m-2.05 0l-1.5 1.5",
  bolt: "M13 10V3L4 14h7v7l9-11h-7z",
  check: "M5 13l4 4L19 7",
  close: "M6 18L18 6M6 6l12 12",
  mail: "M4 4h16v16H4z M22 6l-10 7L2 6",
};

function Badge({ variant, children }: { variant: string; children: React.ReactNode }) {
  return <span className={`badge badge-${variant}`}><span className="badge-dot" />{children}</span>;
}

function formatDate(value?: string | null) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminControlPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [tasks, setTasks] = useState<OpsTask[]>([]);
  const [approvals, setApprovals] = useState<OpsApproval[]>([]);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [typeFilter, setTypeFilter] = useState("all");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    type: "payroll_approval",
    recipientEmail: "",
    subject: "",
    approvalKind: "payroll",
    payload: "{\n  \"note\": \"review required\"\n}",
  });

  useEffect(() => {
    const ctx = loadCompanyContext();
    setCompanyId(ctx?.id ?? null);
  }, []);

  const pendingCount = useMemo(() => tasks.filter(t => t.status === "pending").length, [tasks]);
  const sentCount = useMemo(() => tasks.filter(t => t.status === "sent").length, [tasks]);
  const approvedCount = useMemo(() => tasks.filter(t => t.status === "approved").length, [tasks]);

  const lastAgentLog = logs[0]?.timestamp ?? null;

  async function requestJson(path: string, init?: RequestInit) {
    const res = await fetch(path, init);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error ?? `Request failed (${res.status})`);
    }
    return data;
  }

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);

      const [healthRes, tasksRes, approvalsRes, logsRes] = await Promise.all([
        requestJson("/api/admin/health"),
        requestJson(`/api/admin/ops/tasks?${params.toString()}`),
        requestJson(`/api/admin/ops/approvals${companyId ? `?companyId=${companyId}` : ""}`),
        requestJson(`/api/admin/agents/logs${companyId ? `?companyId=${companyId}` : ""}`),
      ]);

      setHealth(healthRes);
      setTasks(tasksRes.tasks ?? []);
      setApprovals(approvalsRes.approvals ?? []);
      setLogs(logsRes.logs ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
  }, [companyId, statusFilter, typeFilter]);

  async function runPayroll() {
    setActionMessage(null);
    if (!companyId) {
      setActionMessage("Select a company first.");
      return;
    }
    try {
      await apiFetch("/payroll/run", {
        method: "POST",
        body: JSON.stringify({ companyId }),
      });
      setActionMessage("Payroll triggered. Awaiting approval if required.");
      fetchAll();
    } catch (err: any) {
      setActionMessage(err?.message ?? "Failed to run payroll");
    }
  }

  async function createOpsTask() {
    setActionMessage(null);
    if (!companyId) {
      setActionMessage("Select a company first.");
      return;
    }
    let payload: Record<string, any> = {};
    try {
      payload = createForm.payload ? JSON.parse(createForm.payload) : {};
    } catch {
      setActionMessage("Invalid JSON payload");
      return;
    }

    try {
      await requestJson("/api/admin/ops/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          type: createForm.type,
          payload,
          subject: createForm.subject || undefined,
          recipientEmail: createForm.recipientEmail || undefined,
          approvalKind: createForm.approvalKind || undefined,
        }),
      });
      setActionMessage("Ops task created and queued for OpenClaw.");
      fetchAll();
    } catch (err: any) {
      setActionMessage(err?.message ?? "Failed to create ops task");
    }
  }

  async function decideApproval(id: string, decision: "approve" | "deny") {
    setActionMessage(null);
    try {
      await requestJson(`/api/admin/ops/approvals/${id}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decidedBy: "admin-dashboard" }),
      });
      setActionMessage(`Approval ${decision}d.`);
      fetchAll();
    } catch (err: any) {
      setActionMessage(err?.message ?? "Failed to update approval");
    }
  }

  return (
    <div className="stack-xl">
      <div className="page-header-row">
        <div className="page-header">
          <h1 className="page-title">Admin Control Center</h1>
          <p className="page-subtitle">Monitor automation, approvals, and operational workflows in one place.</p>
        </div>
        <div className="row">
          <button className="btn btn-secondary" onClick={fetchAll}>
            <Icon d={Icons.refresh} size={14} />
            Refresh
          </button>
          <button className="btn btn-primary" onClick={runPayroll}>
            <Icon d={Icons.bolt} size={14} />
            Run Payroll
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="alert alert-info">
          <span className="alert-icon"><Icon d={Icons.mail} size={16} /></span>
          <div>{actionMessage}</div>
        </div>
      )}

      {error && (
        <div className="alert alert-danger">
          <span className="alert-icon"><Icon d={Icons.close} size={16} /></span>
          <div>{error}</div>
        </div>
      )}

      <div className="grid-4">
        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Backend Health</div>
            <div className="metric-card-icon icon-bg-success">
              <Icon d="M9 12l2 2 4-4" size={16} />
            </div>
          </div>
          <div className="metric-card-value monospace">{health?.status ?? "N/A"}</div>
          <div className="metric-card-change neutral">API ping status</div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Open Tasks</div>
            <div className="metric-card-icon icon-bg-warning">
              <Icon d="M12 8v4l3 3" size={16} />
            </div>
          </div>
          <div className="metric-card-value font-num">{pendingCount}</div>
          <div className="metric-card-change neutral">Pending approvals</div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Sent Queue</div>
            <div className="metric-card-icon icon-bg-info">
              <Icon d="M22 6l-10 7L2 6" size={16} />
            </div>
          </div>
          <div className="metric-card-value font-num">{sentCount}</div>
          <div className="metric-card-change neutral">Awaiting replies</div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Approved</div>
            <div className="metric-card-icon icon-bg-emerald">
              <Icon d={Icons.check} size={16} />
            </div>
          </div>
          <div className="metric-card-value font-num">{approvedCount}</div>
          <div className="metric-card-change neutral">Completed approvals</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Create Ops Task</div>
              <div className="card-subtitle">Manually queue tasks for OpenClaw to process.</div>
            </div>
          </div>
          <div className="card-body stack-sm">
            <div className="row-wrap">
              <div style={{ minWidth: 180, flex: 1 }}>
                <div className="text-xs text-secondary">Task Type</div>
                <select
                  className="form-select"
                  value={createForm.type}
                  onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}
                >
                  {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ minWidth: 180, flex: 1 }}>
                <div className="text-xs text-secondary">Approval Kind</div>
                <input
                  className="form-input"
                  placeholder="payroll | loan | contract | ..."
                  value={createForm.approvalKind}
                  onChange={(e) => setCreateForm({ ...createForm, approvalKind: e.target.value })}
                />
              </div>
            </div>
            <div className="row-wrap">
              <div style={{ minWidth: 220, flex: 1 }}>
                <div className="text-xs text-secondary">Recipient Email</div>
                <input
                  className="form-input"
                  placeholder="admin@example.com"
                  value={createForm.recipientEmail}
                  onChange={(e) => setCreateForm({ ...createForm, recipientEmail: e.target.value })}
                />
              </div>
              <div style={{ minWidth: 220, flex: 1 }}>
                <div className="text-xs text-secondary">Subject</div>
                <input
                  className="form-input"
                  placeholder="Optional subject"
                  value={createForm.subject}
                  onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })}
                />
              </div>
            </div>
            <div>
              <div className="text-xs text-secondary">Payload (JSON)</div>
              <textarea
                className="form-textarea"
                rows={6}
                value={createForm.payload}
                onChange={(e) => setCreateForm({ ...createForm, payload: e.target.value })}
              />
            </div>
            <div className="row">
              <button className="btn btn-primary" onClick={createOpsTask}>
                <Icon d={Icons.bolt} size={14} />
                Queue Task
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Automation Status</div>
              <div className="card-subtitle">OpenClaw + agent activity summary.</div>
            </div>
          </div>
          <div className="card-body stack-sm">
            <div className="row-between">
              <span className="text-sm text-secondary">Company Context</span>
              <span className="text-sm font-num">{companyId ?? "Not selected"}</span>
            </div>
            <div className="row-between">
              <span className="text-sm text-secondary">Latest Agent Log</span>
              <span className="text-sm">{formatDate(lastAgentLog)}</span>
            </div>
            <div className="row-between">
              <span className="text-sm text-secondary">Tasks in Queue</span>
              <span className="text-sm font-num">{tasks.length}</span>
            </div>
            <div className="row-between">
              <span className="text-sm text-secondary">Approvals Pending</span>
              <span className="text-sm font-num">{approvals.filter(a => a.status === "pending").length}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Ops Tasks</div>
              <div className="card-subtitle">Workflow tasks generated by the system.</div>
            </div>
            <div className="row">
              <select
                className="form-select"
                style={{ minWidth: 140 }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="pending">pending</option>
                <option value="sent">sent</option>
                <option value="approved">approved</option>
                <option value="denied">denied</option>
                <option value="completed">completed</option>
                <option value="cancelled">cancelled</option>
                <option value="all">all</option>
              </select>
              <select
                className="form-select"
                style={{ minWidth: 160 }}
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">all types</option>
                {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Recipient</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4}>Loading...</td></tr>
                ) : tasks.length === 0 ? (
                  <tr><td colSpan={4}>No tasks found.</td></tr>
                ) : tasks.map((task) => (
                  <tr key={task.id}>
                    <td className="text-xs">{task.type}</td>
                    <td><Badge variant={STATUS_BADGE[task.status] ?? "neutral"}>{task.status}</Badge></td>
                    <td className="text-xs">{task.recipient_email ?? "N/A"}</td>
                    <td className="text-xs">{formatDate(task.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Approvals</div>
              <div className="card-subtitle">Manually approve or deny workflows.</div>
            </div>
          </div>
          <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th className="right">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4}>Loading...</td></tr>
                ) : approvals.length === 0 ? (
                  <tr><td colSpan={4}>No approvals found.</td></tr>
                ) : approvals.map((approval) => (
                  <tr key={approval.id}>
                    <td className="text-xs">{approval.task_type ?? approval.kind}</td>
                    <td><Badge variant={STATUS_BADGE[approval.status] ?? "neutral"}>{approval.status}</Badge></td>
                    <td className="text-xs">{formatDate(approval.requested_at)}</td>
                    <td className="right">
                      {approval.status === "pending" ? (
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => decideApproval(approval.id, "deny")}>
                            Deny
                          </button>
                          <button className="btn btn-primary btn-sm" onClick={() => decideApproval(approval.id, "approve")}>
                            Approve
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-secondary">N/A</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Agent Activity Logs</div>
            <div className="card-subtitle">Latest orchestration decisions and actions.</div>
          </div>
        </div>
        <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Agent</th>
                <th>Action</th>
                <th>Rationale</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4}>Loading...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={4}>No agent logs found.</td></tr>
              ) : logs.map((log) => (
                <tr key={log.id}>
                  <td className="text-xs">{formatDate(log.timestamp)}</td>
                  <td className="text-xs">{log.agent_name}</td>
                  <td className="text-xs">{log.action_taken}</td>
                  <td className="text-xs" style={{ maxWidth: 420 }}>{log.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
