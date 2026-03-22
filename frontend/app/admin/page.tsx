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
  workflow_id?: string | null;
  workflow_name?: string | null;
  stage?: string | null;
  source?: string | null;
  policy_result?: {
    status?: "allow" | "review" | "block";
    reasons?: string[];
  } | null;
  execution_status?: string | null;
  metadata?: Record<string, any> | null;
};

type Health = { status: string };

const STATUS_BADGE: Record<string, string> = {
  pending: "warning",
  sent: "info",
  approved: "success",
  denied: "danger",
  completed: "neutral",
  cancelled: "neutral",
  success: "success",
  failed: "danger",
  shortfall: "warning",
  started: "info",
  running: "info",
};

const STAGE_BADGE: Record<string, string> = {
  workflow: "info",
  decision: "primary",
  policy_validation: "warning",
  wdk_execution: "success",
  guardrail: "danger",
};

const POLICY_BADGE: Record<string, string> = {
  allow: "success",
  review: "warning",
  block: "danger",
};

const TASK_TYPES = [
  "finance_snapshot",
  "reconciliation_report",
  "payroll_prep",
  "eod_summary",
  "payroll_approval",
  "loan_approval",
  "employee_invite",
  "treasury_topup",
  "settlement_alert",
  "monitoring_alert",
  "workflow_retry",
  "browser_automation",
  "notification_alert",
  "admin_report",
  "contract_approval",
  "kyc_request",
  "support_ticket",
];

const LOG_STAGE_OPTIONS = [
  { value: "all", label: "All stages" },
  { value: "workflow", label: "Workflow" },
  { value: "decision", label: "Decision" },
  { value: "policy_validation", label: "Policy validation" },
  { value: "wdk_execution", label: "WDK execution" },
  { value: "guardrail", label: "Guardrail" },
];

const LOG_POLICY_OPTIONS = [
  { value: "all", label: "All policy states" },
  { value: "allow", label: "Allow" },
  { value: "review", label: "Review" },
  { value: "block", label: "Block" },
  { value: "none", label: "No verdict" },
];

const LOG_LIMIT_OPTIONS = [
  { value: "6", label: "6 events" },
  { value: "12", label: "12 events" },
  { value: "24", label: "24 events" },
  { value: "all", label: "All events" },
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
  chevronDown: "M6 9l6 6 6-6",
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

function formatJsonBlock(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function DeckSectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="admin-section-head">
      <div className="admin-section-kicker">{eyebrow}</div>
      <h2 className="admin-section-title">{title}</h2>
      <p className="admin-section-subtitle">{subtitle}</p>
    </div>
  );
}

function FoldCard({
  title,
  subtitle,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle: string;
  count?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="deck-fold-card" open={defaultOpen ? true : undefined}>
      <summary className="deck-fold-summary">
        <div className="deck-fold-summary-copy">
          <div className="card-title">{title}</div>
          <div className="card-subtitle">{subtitle}</div>
        </div>
        <div className="deck-fold-summary-meta">
          {count ? <Badge variant="neutral">{count}</Badge> : null}
          <span className="deck-fold-toggle">
            <Icon d={Icons.chevronDown} size={14} />
          </span>
        </div>
      </summary>
      <div className="deck-fold-content">{children}</div>
    </details>
  );
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
  const [logStageFilter, setLogStageFilter] = useState("all");
  const [logPolicyFilter, setLogPolicyFilter] = useState("all");
  const [logLimit, setLogLimit] = useState("12");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [strategyRunning, setStrategyRunning] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [lastWorkflow, setLastWorkflow] = useState<any | null>(null);
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
  const pendingApprovalCount = useMemo(() => approvals.filter(a => a.status === "pending").length, [approvals]);
  const policyReviewCount = useMemo(() => logs.filter(log => log.policy_result?.status === "review").length, [logs]);
  const policyBlockCount = useMemo(() => logs.filter(log => log.policy_result?.status === "block").length, [logs]);
  const decisionCount = useMemo(() => logs.filter(log => log.stage === "decision").length, [logs]);
  const policyValidationCount = useMemo(() => logs.filter(log => log.stage === "policy_validation").length, [logs]);
  const executionCount = useMemo(() => logs.filter(log => log.stage === "wdk_execution").length, [logs]);
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const stageMatches = logStageFilter === "all" || (log.stage ?? "workflow") === logStageFilter;
      const policyStatus = log.policy_result?.status ?? "none";
      const policyMatches = logPolicyFilter === "all" || policyStatus === logPolicyFilter;
      return stageMatches && policyMatches;
    });
  }, [logs, logPolicyFilter, logStageFilter]);
  const visibleLogs = useMemo(() => {
    if (logLimit === "all") {
      return filteredLogs;
    }
    return filteredLogs.slice(0, Number(logLimit));
  }, [filteredLogs, logLimit]);
  const recentWorkflows = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; stageCount: number; lastSeen: string; status: string }>();
    for (const log of logs) {
      if (!log.workflow_id) continue;
      if (!grouped.has(log.workflow_id)) {
        grouped.set(log.workflow_id, {
          id: log.workflow_id,
          name: log.workflow_name ?? "workflow",
          stageCount: 0,
          lastSeen: log.timestamp,
          status: log.execution_status ?? "running"
        });
      }
      const current = grouped.get(log.workflow_id)!;
      current.stageCount += 1;
      if (new Date(log.timestamp).getTime() > new Date(current.lastSeen).getTime()) {
        current.lastSeen = log.timestamp;
        current.status = log.execution_status ?? current.status;
      }
    }
    return Array.from(grouped.values())
      .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
      .slice(0, 6);
  }, [logs]);

  const lastAgentLog = logs[0]?.timestamp ?? null;
  const failedWorkflowCount = useMemo(() => recentWorkflows.filter(workflow => workflow.status === "failed").length, [recentWorkflows]);
  const lastExecutionLog = useMemo(() => logs.find(log => log.stage === "wdk_execution") ?? null, [logs]);
  const runtimeBadgeVariant = health?.status === "ok" ? "success" : loading ? "info" : "danger";
  const pipelineSteps = [
    {
      label: "Agent Decision",
      description: "OpenClaw on EC2 generates treasury, lending, payroll, and investment intents.",
      value: decisionCount,
      badge: "info",
    },
    {
      label: "Policy Validation",
      description: "FlowPay enforces wallet permissions, transfer caps, and review thresholds.",
      value: policyValidationCount,
      badge: "warning",
    },
    {
      label: "WDK Execution",
      description: "Approved actions execute through the wallet layer and settle on Ethereum stablecoin rails.",
      value: executionCount,
      badge: "success",
    },
  ];

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

  async function runAutomation(job: string = "all") {
    setActionMessage(null);
    try {
      await requestJson("/api/admin/ops/automation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job,
          companyId: companyId ?? undefined,
        }),
      });
      setActionMessage(`Automation job "${job}" triggered.`);
      fetchAll();
    } catch (err: any) {
      setActionMessage(err?.message ?? "Failed to run automation job");
    }
  }

  async function runOrchestration(mode: "strategy" | "demo") {
    setActionMessage(null);
    if (!companyId) {
      setActionMessage("Select a company first.");
      return;
    }

    if (mode === "strategy") {
      setStrategyRunning(true);
    } else {
      setDemoRunning(true);
    }

    try {
      const data = await requestJson("/api/admin/ops/orchestration/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          companyId,
        }),
      });
      setLastWorkflow(data?.result ?? null);
      setActionMessage(mode === "demo" ? "Autonomous demo triggered." : "OpenClaw strategy run triggered.");
      fetchAll();
    } catch (err: any) {
      setActionMessage(err?.message ?? `Failed to run ${mode}`);
    } finally {
      if (mode === "strategy") {
        setStrategyRunning(false);
      } else {
        setDemoRunning(false);
      }
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
      <section className="admin-command-deck">
        <div className="admin-command-main">
          <div className="admin-command-header">
            <div>
              <div className="admin-command-kicker">OpenClaw on EC2 | FlowPay policy engine | WDK execution</div>
              <h1 className="admin-command-title">OpenClaw Command Deck</h1>
              <p className="admin-command-subtitle">
                Run the autonomous treasury, lending, payroll, and reserve-wallet flows from one surface.
                Strategy and demo actions are consolidated here so the control plane mirrors the actual runtime.
              </p>
            </div>
            <div className="admin-command-status">
              <Badge variant={runtimeBadgeVariant}>
                {health?.status === "ok" ? "EC2 live" : loading ? "Syncing runtime" : "Runtime issue"}
              </Badge>
            </div>
          </div>

          <div className="admin-context-strip">
            <div className="admin-context-chip">
              <div className="admin-context-label">Company Context</div>
              <div className="admin-context-value font-mono">{companyId ?? "Not selected"}</div>
            </div>
            <div className="admin-context-chip">
              <div className="admin-context-label">Settlement Rail</div>
              <div className="admin-context-value">Ethereum USDT</div>
            </div>
            <div className="admin-context-chip">
              <div className="admin-context-label">Last Agent Event</div>
              <div className="admin-context-value">{formatDate(lastAgentLog)}</div>
            </div>
            <div className="admin-context-chip">
              <div className="admin-context-label">Tracked Workflows</div>
              <div className="admin-context-value font-num">{recentWorkflows.length}</div>
            </div>
          </div>

          <div className="admin-actions-grid">
            <button
              className="admin-action-card primary"
              onClick={() => runOrchestration("demo")}
              disabled={demoRunning}
            >
              <span className="admin-action-label">{demoRunning ? "Running Demo..." : "Run Autonomous Demo"}</span>
              <span className="admin-action-desc">Treasury funding, allocation, loan disbursal, payroll EMI, and Aave rebalance.</span>
            </button>
            <button
              className="admin-action-card secondary"
              onClick={() => runOrchestration("strategy")}
              disabled={strategyRunning}
            >
              <span className="admin-action-label">{strategyRunning ? "Running Strategy..." : "Run OpenClaw Strategy"}</span>
              <span className="admin-action-desc">Kick the EC2 strategy loop without the demo wrapper.</span>
            </button>
            <button className="admin-action-card utility" onClick={runPayroll}>
              <span className="admin-action-label">Run Payroll</span>
              <span className="admin-action-desc">Trigger payroll and let the policy layer decide whether approval is required.</span>
            </button>
            <button className="admin-action-card utility" onClick={() => runAutomation("all")}>
              <span className="admin-action-label">Run Automation</span>
              <span className="admin-action-desc">Refresh ops tasks, alerts, reports, and retry jobs for the selected company.</span>
            </button>
            <button className="admin-action-card utility" onClick={fetchAll}>
              <span className="admin-action-label">Refresh Data</span>
              <span className="admin-action-desc">Reload health, workflow, approval, and audit data from the backend.</span>
            </button>
          </div>
        </div>

        <aside className="admin-side-panel">
          <div>
            <div className="card-title">Execution Pipeline</div>
            <div className="card-subtitle">Visible guardrails from agent intent to on-chain settlement.</div>
          </div>

          <div className="admin-pipeline-list">
            {pipelineSteps.map((step) => (
              <div key={step.label} className="admin-pipeline-step">
                <div className="admin-pipeline-top">
                  <div>
                    <div className="admin-pipeline-kicker">Stage</div>
                    <div className="fw-semi">{step.label}</div>
                  </div>
                  <Badge variant={step.badge}>{step.value}</Badge>
                </div>
                <div className="text-xs text-secondary mt-2">{step.description}</div>
              </div>
            ))}
          </div>

          <div className="admin-side-stats">
            <div className="admin-side-stat">
              <div className="admin-side-stat-label">Pending approvals</div>
              <div className="admin-side-stat-value font-num">{pendingApprovalCount}</div>
            </div>
            <div className="admin-side-stat">
              <div className="admin-side-stat-label">Policy reviews</div>
              <div className="admin-side-stat-value font-num">{policyReviewCount}</div>
            </div>
            <div className="admin-side-stat">
              <div className="admin-side-stat-label">Guardrail blocks</div>
              <div className="admin-side-stat-value font-num">{policyBlockCount}</div>
            </div>
            <div className="admin-side-stat">
              <div className="admin-side-stat-label">Failed workflows</div>
              <div className="admin-side-stat-value font-num">{failedWorkflowCount}</div>
            </div>
          </div>
        </aside>
      </section>

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

      <section className="admin-section">
        <DeckSectionHeader
          eyebrow="Control Posture"
          title="Deck Telemetry"
          subtitle="Key runtime counts stay in a single aligned strip so the command deck reads like an operator console."
        />
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
      </section>

      <section className="admin-section">
        <DeckSectionHeader
          eyebrow="Operator Controls"
          title="Runbooks and Runtime"
          subtitle="Primary actions, manual ops task creation, and runtime health are grouped into balanced cards with fixed spacing."
        />
        <div className="grid-2 admin-grid-stretch">
          <div className="card admin-panel-card">
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

          <div className="card admin-panel-card">
            <div className="card-header">
              <div>
                <div className="card-title">Runtime Snapshot</div>
                <div className="card-subtitle">Live EC2 state, workflow health, and last wallet execution.</div>
              </div>
            </div>
            <div className="card-body stack-sm">
              <div className="row-between">
                <span className="text-sm text-secondary">Backend Health</span>
                <span className="text-sm font-num">{health?.status ?? "N/A"}</span>
              </div>
              <div className="row-between">
                <span className="text-sm text-secondary">Queue Pending</span>
                <span className="text-sm font-num">{pendingCount}</span>
              </div>
              <div className="row-between">
                <span className="text-sm text-secondary">Approvals Pending</span>
                <span className="text-sm font-num">{pendingApprovalCount}</span>
              </div>
              <div className="row-between">
                <span className="text-sm text-secondary">Policy Reviews</span>
                <span className="text-sm font-num">{policyReviewCount}</span>
              </div>
              <div className="row-between">
                <span className="text-sm text-secondary">Last Agent Log</span>
                <span className="text-sm">{formatDate(lastAgentLog)}</span>
              </div>
              <div className="row-between">
                <span className="text-sm text-secondary">Tracked Workflows</span>
                <span className="text-sm font-num">{recentWorkflows.length}</span>
              </div>
              <div className="admin-note-card">
                <div className="fw-medium text-sm">Last WDK Execution</div>
                <div className="text-xs text-secondary mt-1">
                  {lastExecutionLog ? `${lastExecutionLog.action_taken} | ${lastExecutionLog.execution_status ?? "pending"}` : "No wallet execution logged yet."}
                </div>
                {lastExecutionLog?.rationale ? (
                  <div className="text-xs text-secondary mt-2" style={{ wordBreak: "break-word" }}>
                    {lastExecutionLog.rationale}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="admin-section">
        <DeckSectionHeader
          eyebrow="System Map"
          title="Architecture and Workflow State"
          subtitle="Reference context and recent orchestration output stay separated from operator queues."
        />
        <div className="grid-2 admin-grid-stretch">
        <div className="card admin-panel-card">
          <div className="card-header">
            <div>
              <div className="card-title">Architecture Slide</div>
              <div className="card-subtitle">Hackathon framing for the current testnet prototype.</div>
            </div>
          </div>
          <div className="card-body stack-sm">
            <div className="admin-note-card">
              <div className="fw-medium text-sm">1. OpenClaw reasoning on EC2</div>
              <div className="text-xs text-secondary mt-1">Runs strategy loops, launches the autonomous demo, and pushes intents into FlowPay.</div>
            </div>
            <div className="admin-note-card">
              <div className="fw-medium text-sm">2. FlowPay backend policy layer</div>
              <div className="text-xs text-secondary mt-1">Applies wallet permissions, max transfer limits, daily outflow caps, and review thresholds before execution.</div>
            </div>
            <div className="admin-note-card">
              <div className="fw-medium text-sm">3. WDK wallet execution</div>
              <div className="text-xs text-secondary mt-1">Treasury allocation, loan disbursal, payroll, and Aave actions are executed through the WDK-backed wallet layer.</div>
            </div>
            <div className="admin-note-card">
              <div className="fw-medium text-sm">4. On-chain settlement</div>
              <div className="text-xs text-secondary mt-1">Primary settlement now runs on Ethereum stablecoin rails, while any legacy contract sync can remain isolated until mainnet contract addresses are supplied.</div>
            </div>
          </div>
        </div>

        <FoldCard
          title="Workflow Tracker"
          subtitle="Recent orchestration runs and their latest states."
          count={`${recentWorkflows.length} tracked`}
          defaultOpen
        >
          <div className="deck-scroll-panel deck-scroll-panel-md stack-sm">
            {recentWorkflows.length === 0 ? (
              <div className="text-sm text-secondary">No orchestration workflows logged yet.</div>
            ) : recentWorkflows.map((workflow) => (
              <div key={workflow.id} className="admin-scroll-item">
                <div>
                  <div className="fw-medium text-sm">{workflow.name}</div>
                  <div className="text-xs text-secondary mt-1">{workflow.id}</div>
                </div>
                <div className="admin-scroll-item-meta">
                  <div><Badge variant={STATUS_BADGE[workflow.status] ?? "neutral"}>{workflow.status}</Badge></div>
                  <div className="text-xs text-secondary mt-1">{workflow.stageCount} events | {formatDate(workflow.lastSeen)}</div>
                </div>
              </div>
            ))}
            {lastWorkflow ? (
              <div className="admin-note-card">
                <div className="fw-medium text-sm">Last Triggered Result</div>
                <div className="text-xs text-secondary mt-1" style={{ wordBreak: "break-word" }}>
                  {JSON.stringify(lastWorkflow)}
                </div>
              </div>
            ) : null}
          </div>
        </FoldCard>
        </div>
      </section>

      <section className="admin-section">
        <DeckSectionHeader
          eyebrow="Operator Queues"
          title="Expandable Data Panels"
          subtitle="Long-form task and approval queues are moved into dropdown cards with internal scroll regions so the deck stays compact."
        />
        <div className="grid-2 admin-grid-stretch">
        <FoldCard
          title="Ops Tasks"
          subtitle="Workflow tasks generated by the system."
          count={`${tasks.length} tasks`}
          defaultOpen
        >
          <div className="deck-panel-toolbar">
              <select
                className="form-select"
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
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">all types</option>
                {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
          </div>
          <div className="deck-scroll-panel deck-scroll-panel-md">
            <div className="data-table-wrapper deck-table-shell">
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
        </FoldCard>

        <FoldCard
          title="Approvals"
          subtitle="Manually approve or deny workflows."
          count={`${approvals.length} approvals`}
        >
          <div className="deck-scroll-panel deck-scroll-panel-md">
            <div className="data-table-wrapper deck-table-shell">
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
        </FoldCard>
        </div>
      </section>

      <section className="admin-section">
        <DeckSectionHeader
          eyebrow="Audit Trail"
          title="Agent Activity Logs"
          subtitle="Decision to policy validation to WDK execution audit entries are contained in a dropdown feed with scrollable detail panels."
        />
        <FoldCard
          title="Agent Activity Logs"
          subtitle="Decision to policy validation to WDK execution audit trail."
          count={`${visibleLogs.length} visible`}
          defaultOpen
        >
          <div className="agent-log-controls">
            <label className="agent-log-control">
              <span>Stage</span>
              <select
                className="form-select"
                value={logStageFilter}
                onChange={(e) => setLogStageFilter(e.target.value)}
              >
                {LOG_STAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="agent-log-control">
              <span>Policy</span>
              <select
                className="form-select"
                value={logPolicyFilter}
                onChange={(e) => setLogPolicyFilter(e.target.value)}
              >
                {LOG_POLICY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="agent-log-control">
              <span>View</span>
              <select
                className="form-select"
                value={logLimit}
                onChange={(e) => setLogLimit(e.target.value)}
              >
                {LOG_LIMIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="agent-log-summary-bar">
            <div className="agent-log-summary-chip">
              <span className="agent-log-summary-label">Showing</span>
              <span className="agent-log-summary-value font-num">{visibleLogs.length}</span>
            </div>
            <div className="agent-log-summary-chip">
              <span className="agent-log-summary-label">Filtered from</span>
              <span className="agent-log-summary-value font-num">{logs.length}</span>
            </div>
            <div className="agent-log-summary-chip">
              <span className="agent-log-summary-label">Latest Event</span>
              <span className="agent-log-summary-value">{formatDate(lastAgentLog)}</span>
            </div>
            <div className="agent-log-summary-chip">
              <span className="agent-log-summary-label">Policy Reviews</span>
              <span className="agent-log-summary-value font-num">{policyReviewCount}</span>
            </div>
          </div>

          {loading ? (
            <div className="agent-log-empty">Loading agent activity...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="agent-log-empty">No agent activity matches the current filters.</div>
          ) : (
            <div className="deck-scroll-panel deck-scroll-panel-lg">
              <div className="agent-log-list">
                {visibleLogs.map((log) => {
                  const policyStatus = log.policy_result?.status;
                  const workflowLabel = log.workflow_name ?? "General activity";
                  const workflowId = log.workflow_id ?? "No workflow id";
                  const stageLabel = log.stage ?? "workflow";

                  return (
                    <details key={log.id} className="agent-log-entry">
                      <summary className="agent-log-entry-summary">
                        <div className="agent-log-main">
                          <div className="agent-log-topline">
                            <span className="text-xs text-secondary">{formatDate(log.timestamp)}</span>
                            <Badge variant={STAGE_BADGE[stageLabel] ?? "neutral"}>{stageLabel}</Badge>
                            <Badge variant="info">{log.agent_name}</Badge>
                            {policyStatus ? (
                              <Badge variant={POLICY_BADGE[policyStatus] ?? "neutral"}>{policyStatus}</Badge>
                            ) : (
                              <Badge variant="neutral">no policy</Badge>
                            )}
                          </div>
                          <div className="agent-log-action">{log.action_taken}</div>
                          <div className="agent-log-meta">
                            <span>{workflowLabel}</span>
                            <span>{workflowId}</span>
                            {log.source ? <span>{log.source}</span> : null}
                            {log.execution_status ? <span>{log.execution_status}</span> : null}
                          </div>
                        </div>
                        <span className="agent-log-expand">
                          <span>Details</span>
                          <span className="agent-log-expand-icon"><Icon d={Icons.chevronDown} size={14} /></span>
                        </span>
                      </summary>

                      <div className="agent-log-detail-grid">
                        <div className="agent-log-detail-card">
                          <div className="agent-log-detail-label">Rationale</div>
                          <p className="text-sm text-secondary">{log.rationale || "No rationale recorded."}</p>
                        </div>

                        <div className="agent-log-detail-card">
                          <div className="agent-log-detail-label">Policy Outcome</div>
                          <p className="text-sm text-secondary">
                            {policyStatus ? `Result: ${policyStatus}` : "No policy verdict recorded for this step."}
                          </p>
                          {log.policy_result?.reasons?.length ? (
                            <div className="agent-log-reason-list">
                              {log.policy_result.reasons.map((reason) => (
                                <div key={reason} className="agent-log-reason-item">{reason}</div>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        {log.decision ? (
                          <div className="agent-log-detail-card">
                            <div className="agent-log-detail-label">Decision Payload</div>
                            <pre className="agent-log-json">{formatJsonBlock(log.decision)}</pre>
                          </div>
                        ) : null}

                        {log.metadata ? (
                          <div className="agent-log-detail-card">
                            <div className="agent-log-detail-label">Execution Metadata</div>
                            <pre className="agent-log-json">{formatJsonBlock(log.metadata)}</pre>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
          )}
        </FoldCard>
      </section>
    </div>
  );
}
