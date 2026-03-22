import "dotenv/config";
import fs from "fs";
import path from "path";
import { google } from "googleapis";

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

type State = {
  processedMessageIds: string[];
};

const FLOWPAY_API_URL = process.env.FLOWPAY_API_URL ?? "http://localhost:4000";
const MASTER_KEY = process.env.MASTER_KEY ?? "";
const EMAIL_FROM =
  process.env.EMAIL_FROM ??
  process.env.CLAWGENCY_PLATFORM_EMAIL ??
  process.env.GMAIL_SENDER_EMAIL ??
  "";
const REPLY_LABEL = process.env.GMAIL_REPLY_LABEL ?? "flowpay";
const STATE_FILE = process.env.OPENCLAW_STATE_FILE ?? ".secrets/openclaw-ops-state.json";
const LOOP_INTERVAL_MS = parseInt(process.env.OPENCLAW_POLL_INTERVAL_MS ?? "60000", 10);
const STRATEGY_ENABLED = (process.env.OPENCLAW_STRATEGY_ENABLED ?? "false").toLowerCase() === "true";
const CLAWBOT_AUTOMATION_ENABLED =
  (process.env.OPENCLAW_AUTOMATE_TASKS ?? "false").toLowerCase() === "true";
const OPENCLAW_GATEWAY_URL = (process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789").replace(/\/+$/, "");
const OPENCLAW_HOOKS_TOKEN = process.env.OPENCLAW_HOOKS_TOKEN ?? "";
const OPENCLAW_HOOKS_AGENT_ID = process.env.OPENCLAW_HOOKS_AGENT_ID?.trim() || "";
const OPENCLAW_HOOK_MODEL = process.env.OPENCLAW_HOOK_MODEL?.trim() || "";
const OPENCLAW_HOOK_THINKING = process.env.OPENCLAW_HOOK_THINKING?.trim() || "";
const OPENCLAW_HOOK_TIMEOUT_SECONDS = parseInt(
  process.env.OPENCLAW_HOOK_TIMEOUT_SECONDS ?? "180",
  10
);
const STRATEGY_INTERVAL_MS = parseInt(
  process.env.OPENCLAW_STRATEGY_INTERVAL_MS ?? String(Math.max(LOOP_INTERVAL_MS, 300000)),
  10
);
const STRATEGY_COMPANY_IDS = (process.env.OPENCLAW_STRATEGY_COMPANY_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

let lastStrategyRunAt = 0;
const CLAWBOT_AUTOMATABLE_TASK_TYPES = new Set([
  "payroll_approval",
  "loan_approval",
  "payroll_prep",
  "treasury_topup",
  "browser_automation",
  "finance_snapshot",
  "reconciliation_report",
  "eod_summary",
  "settlement_alert",
  "monitoring_alert",
  "workflow_retry",
  "notification_alert",
  "kyc_request",
  "contract_approval",
  "admin_report",
  "support_ticket"
]);

if (!MASTER_KEY) {
  console.error("MASTER_KEY is required");
  process.exit(1);
}
if (!EMAIL_FROM && !isClawbotAutomationReady()) {
  console.error("EMAIL_FROM or CLAWGENCY_PLATFORM_EMAIL is required");
  process.exit(1);
}

function isClawbotAutomationReady() {
  return CLAWBOT_AUTOMATION_ENABLED && Boolean(OPENCLAW_HOOKS_TOKEN);
}

function shouldAutomateTask(task: OpsTask) {
  return isClawbotAutomationReady() && CLAWBOT_AUTOMATABLE_TASK_TYPES.has(task.type);
}

function ensureStateDir() {
  const dir = path.dirname(STATE_FILE);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadState(): State {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as State;
    return { processedMessageIds: parsed.processedMessageIds ?? [] };
  } catch {
    return { processedMessageIds: [] };
  }
}

function saveState(state: State) {
  ensureStateDir();
  const deduped = Array.from(new Set(state.processedMessageIds)).slice(-500);
  fs.writeFileSync(STATE_FILE, JSON.stringify({ processedMessageIds: deduped }, null, 2));
}

function readRefreshToken(): string | undefined {
  if (process.env.GMAIL_REFRESH_TOKEN) return process.env.GMAIL_REFRESH_TOKEN;
  if (!process.env.GMAIL_REFRESH_TOKEN_FILE) return undefined;
  try {
    const raw = fs.readFileSync(process.env.GMAIL_REFRESH_TOKEN_FILE, "utf8");
    const data = JSON.parse(raw) as { refresh_token?: string };
    return data.refresh_token;
  } catch {
    return undefined;
  }
}

function resolveGmailClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = readRefreshToken();
  const accessToken = process.env.GMAIL_ACCESS_TOKEN;
  if (!clientId || !clientSecret || (!refreshToken && !accessToken)) {
    throw new Error("Gmail API credentials are not configured");
  }

  const redirectUri =
    process.env.GMAIL_OAUTH_REDIRECT_URI ??
    process.env.GMAIL_REDIRECT_URI ??
    "https://developers.google.com/oauthplayground";
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({
    refresh_token: refreshToken,
    access_token: accessToken
  });

  return google.gmail({ version: "v1", auth });
}

function toBase64Url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function buildPlainTextMessage(params: {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): string {
  const lines = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    ...(params.replyTo ? [`Reply-To: ${params.replyTo}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    params.text
  ];
  return toBase64Url(lines.join("\r\n"));
}

async function fetchOpsTasks(): Promise<OpsTask[]> {
  const res = await fetch(`${FLOWPAY_API_URL}/ops/tasks?status=pending`, {
    headers: { "x-master-key": MASTER_KEY }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ops tasks: ${res.status}`);
  }
  const data = await res.json();
  return data.tasks ?? [];
}

async function markTaskSent(taskId: string) {
  await fetch(`${FLOWPAY_API_URL}/ops/tasks/${taskId}/mark-sent`, {
    method: "POST",
    headers: { "x-master-key": MASTER_KEY }
  });
}

async function markTaskCompleted(taskId: string) {
  await fetch(`${FLOWPAY_API_URL}/ops/tasks/${taskId}/complete`, {
    method: "POST",
    headers: { "x-master-key": MASTER_KEY }
  });
}

async function approve(approvalId: string, decidedBy: string, decisionPayload: Record<string, any>) {
  await fetch(`${FLOWPAY_API_URL}/ops/approvals/${approvalId}/approve`, {
    method: "POST",
    headers: {
      "x-master-key": MASTER_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({ decidedBy, decisionPayload })
  });
}

async function deny(approvalId: string, decidedBy: string, decisionPayload: Record<string, any>) {
  await fetch(`${FLOWPAY_API_URL}/ops/approvals/${approvalId}/deny`, {
    method: "POST",
    headers: {
      "x-master-key": MASTER_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({ decidedBy, decisionPayload })
  });
}

async function runOrchestration(mode: "strategy" | "demo", payload: Record<string, any>) {
  const res = await fetch(`${FLOWPAY_API_URL}/ops/orchestration/run`, {
    method: "POST",
    headers: {
      "x-master-key": MASTER_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      mode,
      source: "openclaw_ec2",
      ...payload
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to run ${mode} orchestration: ${res.status} ${body}`);
  }

  return res.json();
}

async function dispatchHookAgent(message: string, name: string) {
  if (!isClawbotAutomationReady()) {
    throw new Error("OpenClaw clawbot automation is not configured");
  }

  const body: Record<string, unknown> = {
    message,
    name,
    wakeMode: "now",
    deliver: false,
    timeoutSeconds: OPENCLAW_HOOK_TIMEOUT_SECONDS
  };

  if (OPENCLAW_HOOKS_AGENT_ID) {
    body.agentId = OPENCLAW_HOOKS_AGENT_ID;
  }
  if (OPENCLAW_HOOK_MODEL) {
    body.model = OPENCLAW_HOOK_MODEL;
  }
  if (OPENCLAW_HOOK_THINKING) {
    body.thinking = OPENCLAW_HOOK_THINKING;
  }

  const res = await fetch(`${OPENCLAW_GATEWAY_URL}/hooks/agent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENCLAW_HOOKS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenClaw hook dispatch failed (${res.status}): ${errorText}`);
  }

  return res.json().catch(() => ({}));
}

function buildTaskAutomationMessage(task: OpsTask) {
  return [
    "You are the official OpenClaw FlowPay wallet automation agent running on EC2.",
    "Use the flowpay-wallet-ops skill and its local FlowPay admin CLI commands.",
    "Do not ask a human for routine wallet operations.",
    "If the task contains approval_id, you must resolve it with approve or deny.",
    "If the task type is browser_automation, use the browser tool with the provided URL and instructions, then mark the task completed.",
    "If the task is informational, review it and then mark the task completed in FlowPay.",
    "If the task requires external capital injection or some action you cannot actually perform, report the blocker clearly instead of fabricating success.",
    "",
    "Pending FlowPay task payload:",
    JSON.stringify(
      {
        id: task.id,
        company_id: task.company_id,
        type: task.type,
        status: task.status,
        subject: task.subject ?? null,
        approval_id: task.approval_id ?? null,
        recipient_email: task.recipient_email ?? null,
        payload: task.payload ?? {}
      },
      null,
      2
    )
  ].join("\n");
}

async function dispatchTaskToClawbot(task: OpsTask) {
  return dispatchHookAgent(
    buildTaskAutomationMessage(task),
    `FlowPay ${task.type}`
  );
}

async function dispatchStrategyToClawbot(companyId?: string) {
  const message = companyId
    ? [
        "Use the flowpay-wallet-ops skill.",
        "Trigger a FlowPay strategy orchestration run for the specified company using the local admin CLI.",
        "Company ID:",
        companyId
      ].join("\n")
    : [
        "Use the flowpay-wallet-ops skill.",
        "Trigger a FlowPay strategy orchestration run for all companies using the local admin CLI."
      ].join("\n");

  return dispatchHookAgent(message, "FlowPay strategy orchestration");
}

async function maybeRunStrategy() {
  if (!STRATEGY_ENABLED) {
    return;
  }

  const now = Date.now();
  if (now - lastStrategyRunAt < STRATEGY_INTERVAL_MS) {
    return;
  }

  if (STRATEGY_COMPANY_IDS.length === 0) {
    if (isClawbotAutomationReady()) {
      await dispatchStrategyToClawbot();
    } else {
      await runOrchestration("strategy", {});
    }
  } else {
    for (const companyId of STRATEGY_COMPANY_IDS) {
      if (isClawbotAutomationReady()) {
        await dispatchStrategyToClawbot(companyId);
      } else {
        await runOrchestration("strategy", { companyId });
      }
    }
  }

  lastStrategyRunAt = now;
}

function formatTaskEmail(task: OpsTask) {
  const payload = task.payload ?? {};
  const approvalId = task.approval_id ?? "";
  const subject = task.subject
    ?? (approvalId ? `[FlowPay Approval:${approvalId}] Action required` : `[FlowPay Task:${task.id}]`);

  const lines: string[] = [];
  lines.push(`Task type: ${task.type}`);
  lines.push(`Task id: ${task.id}`);
  if (approvalId) lines.push(`Approval id: ${approvalId}`);
  lines.push("");

  if (task.type === "payroll_approval") {
    lines.push(`Company: ${payload.companyId ?? ""}`);
    lines.push(`Active employees: ${payload.activeEmployees ?? 0}`);
    lines.push(`Total salary: ${payload.totalSalary ?? 0}`);
    lines.push(`Treasury balance: ${payload.treasuryBalance ?? 0}`);
    if (payload.treasuryAddress) lines.push(`Treasury address: ${payload.treasuryAddress}`);
    if (payload.shortfall && payload.shortfall > 0) {
      lines.push(`Shortfall: ${payload.shortfall}`);
    }
    lines.push("");
    lines.push("Reply with APPROVE or DENY to decide.");
  } else if (task.type === "loan_approval") {
    lines.push(`Employee: ${payload.employeeName ?? ""} (${payload.employeeEmail ?? ""})`);
    lines.push(`Amount: ${payload.amount ?? 0}`);
    lines.push(`Interest: ${payload.interest ?? 0}%`);
    lines.push(`Duration: ${payload.duration ?? 0} months`);
    lines.push(`EMI: ${payload.emi ?? 0}`);
    lines.push(`Rationale: ${payload.rationale ?? ""}`);
    lines.push("");
    lines.push("Reply with APPROVE or DENY to decide.");
  } else if (task.type === "employee_invite") {
    lines.push(`Welcome to FlowPay.`);
    lines.push(`Employee ID: ${payload.employeeId ?? ""}`);
    lines.push(`Activate here: ${payload.activationUrl ?? ""}`);
  } else if (task.type === "company_access") {
    lines.push(`Your FlowPay employer workspace is ready.`);
    lines.push(`Company ID: ${payload.companyId ?? ""}`);
    if (payload.treasuryAddress) lines.push(`Treasury wallet: ${payload.treasuryAddress}`);
  } else if (task.type === "employee_access") {
    lines.push(`Your FlowPay employee workspace is ready.`);
    lines.push(`Employee ID: ${payload.employeeId ?? ""}`);
    if (payload.walletAddress) lines.push(`Wallet address: ${payload.walletAddress}`);
  } else if (task.type === "company_recovery") {
    lines.push(`A company PIN reset was requested.`);
    lines.push(`Company ID: ${payload.companyId ?? ""}`);
    lines.push(`Reset here: ${payload.resetUrl ?? ""}`);
    lines.push(`Company: ${payload.companyName ?? ""}`);
  } else if (task.type === "employee_recovery") {
    lines.push(`An employee password reset was requested.`);
    lines.push(`Employee ID: ${payload.employeeId ?? ""}`);
    lines.push(`Reset here: ${payload.resetUrl ?? ""}`);
    lines.push(`Employee: ${payload.fullName ?? ""}`);
  } else if (task.type === "payroll_prep") {
    lines.push(`Payroll prep window opened.`);
    lines.push(`Company: ${payload.companyId ?? ""}`);
    lines.push(`Hours to payroll: ${payload.hoursToPayroll ?? ""}`);
    lines.push(`Active employees: ${payload.activeEmployees ?? ""}`);
    lines.push(`Total salary: ${payload.totalSalary ?? ""}`);
    lines.push(`Treasury balance: ${payload.treasuryBalance ?? ""}`);
  } else if (task.type === "payroll_balance_alert") {
    lines.push(`Payroll funding alert triggered.`);
    lines.push(`Company: ${payload.companyName ?? payload.companyId ?? ""}`);
    lines.push(`Payroll month: ${payload.payrollMonthLabel ?? ""}`);
    lines.push(`Scheduled payroll time: ${payload.nextPayrollAt ?? ""}`);
    lines.push(`Hours to payroll: ${payload.hoursToPayroll ?? ""}`);
    lines.push(`Active employees: ${payload.activeEmployees ?? ""}`);
    lines.push(`Unpaid employees this period: ${payload.dueEmployees ?? ""}`);
    lines.push(`Required payroll funding: ${payload.requiredPayrollAmount ?? ""} ${payload.currency ?? ""}`.trim());
    lines.push(`Treasury balance: ${payload.treasuryBalance ?? ""} ${payload.currency ?? ""}`.trim());
    lines.push(`Shortfall: ${payload.shortfall ?? ""} ${payload.currency ?? ""}`.trim());
    lines.push("");
    lines.push("Please fund the treasury before the scheduled payroll run to avoid missed salary disbursements.");
  } else if (task.type === "finance_snapshot") {
    lines.push(`Daily finance snapshot generated.`);
    lines.push(`Company: ${payload.companyName ?? payload.companyId ?? ""}`);
    lines.push(`Hours to payroll: ${payload.hoursToNextPayroll ?? ""}`);
    lines.push("");
    lines.push(JSON.stringify(payload, null, 2));
  } else if (task.type === "reconciliation_report") {
    lines.push(`Reconciliation report generated.`);
    lines.push(`Company: ${payload.companyId ?? ""}`);
    lines.push(`Transactions today: ${payload.txCountToday ?? ""}`);
    lines.push(`Transaction amount today: ${payload.txAmountToday ?? ""}`);
    lines.push(`Pending settlements: ${payload.pendingSettlementCount ?? ""}`);
  } else if (task.type === "eod_summary") {
    lines.push(`End-of-day summary generated.`);
    lines.push(`Company: ${payload.companyName ?? payload.companyId ?? ""}`);
    lines.push("");
    lines.push(JSON.stringify(payload, null, 2));
  } else if (task.type === "treasury_topup") {
    lines.push(`Treasury shortfall: ${payload.shortfall ?? 0}`);
    lines.push(`Balance: ${payload.balanceEth ?? 0}`);
    lines.push(`Monthly payroll: ${payload.monthlyPayroll ?? 0}`);
    lines.push(`Treasury address: ${payload.treasuryAddress ?? ""}`);
  } else if (task.type === "settlement_alert") {
    lines.push(`Settlement alert triggered.`);
    lines.push(`Company: ${payload.companyId ?? ""}`);
    lines.push(`Stalled settlements: ${payload.stalledSettlementCount ?? payload.failedPositions ?? 0}`);
    lines.push("");
    lines.push(JSON.stringify(payload, null, 2));
  } else if (task.type === "monitoring_alert") {
    lines.push(`Infrastructure monitoring alert.`);
    lines.push(`Company: ${payload.companyId ?? ""}`);
    lines.push("");
    lines.push(JSON.stringify(payload, null, 2));
  } else if (task.type === "workflow_retry") {
    lines.push(`Workflow retry queue requires review.`);
    lines.push(`Company: ${payload.companyId ?? ""}`);
    lines.push(`Issue: ${payload.issue ?? ""}`);
    lines.push("");
    lines.push(JSON.stringify(payload, null, 2));
  } else if (task.type === "browser_automation") {
    lines.push(`Browser automation task queued.`);
    lines.push(`Target URL: ${payload.url ?? ""}`);
    lines.push(`Instructions: ${payload.instructions ?? ""}`);
    if (payload.metadata) {
      lines.push("");
      lines.push(`Metadata: ${JSON.stringify(payload.metadata, null, 2)}`);
    }
  } else if (task.type === "notification_alert") {
    lines.push(`FlowPay alert (${payload.severity ?? "info"}).`);
    lines.push(`${payload.title ?? task.subject ?? "Alert"}`);
    lines.push(`${payload.message ?? ""}`);
    if (payload.payload) {
      lines.push("");
      lines.push(`Context: ${JSON.stringify(payload.payload, null, 2)}`);
    }
  } else if (task.type === "admin_report") {
    lines.push(`Weekly summary attached in payload.`);
    lines.push(JSON.stringify(payload, null, 2));
  } else {
    lines.push(JSON.stringify(payload, null, 2));
  }

  return { subject, text: lines.join("\n") };
}

async function sendEmail(to: string, subject: string, text: string) {
  const gmail = resolveGmailClient();
  const raw = buildPlainTextMessage({
    from: EMAIL_FROM,
    to,
    subject,
    text,
    replyTo: process.env.CLAWGENCY_PLATFORM_EMAIL ?? undefined
  });

  const labelId = await resolveLabelId(gmail, REPLY_LABEL);

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      ...(labelId ? { labelIds: [labelId] } : {})
    }
  });
}

async function resolveLabelId(gmail: ReturnType<typeof google.gmail>, labelName: string) {
  if (!labelName) return null;
  const res = await gmail.users.labels.list({ userId: "me" });
  const labels = res.data.labels ?? [];
  for (const label of labels) {
    if (label.name === labelName) return label.id ?? null;
  }
  return null;
}

async function processPendingTasks() {
  const tasks = await fetchOpsTasks();
  for (const task of tasks) {
    if (shouldAutomateTask(task)) {
      await dispatchTaskToClawbot(task);
      await markTaskSent(task.id);
      continue;
    }

    if (!task.recipient_email) {
      console.warn("Skipping task with no recipient", task.id);
      continue;
    }
    const { subject, text } = formatTaskEmail(task);
    await sendEmail(task.recipient_email, subject, text);

    if (task.approval_id) {
      await markTaskSent(task.id);
    } else {
      await markTaskCompleted(task.id);
    }
  }
}

function getHeader(headers: any[], name: string) {
  return headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractPlainText(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  const parts = payload.parts ?? [];
  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
  }
  return "";
}

function parseDecision(text: string): "approve" | "deny" | null {
  const normalized = text.toLowerCase();
  if (normalized.includes("approve")) return "approve";
  if (normalized.includes("deny") || normalized.includes("reject")) return "deny";
  return null;
}

async function processReplies() {
  if (isClawbotAutomationReady()) {
    return;
  }

  const gmail = resolveGmailClient();
  const state = loadState();

  const res = await gmail.users.messages.list({
    userId: "me",
    q: 'subject:"FlowPay Approval" -from:me newer_than:14d',
    maxResults: 50
  });
  const messages = res.data.messages ?? [];

  for (const msg of messages) {
    if (!msg.id || state.processedMessageIds.includes(msg.id)) continue;

    const full = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
    const payload = full.data.payload;
    const headers = payload?.headers ?? [];
    const subject = getHeader(headers, "Subject");
    const from = getHeader(headers, "From");
    const body = extractPlainText(payload);

    const match = subject.match(/FlowPay Approval:([0-9a-f-]{36})/i);
    if (!match) {
      state.processedMessageIds.push(msg.id);
      continue;
    }
    const approvalId = match[1];
    const decision = parseDecision(`${subject}\n${body}`);
    if (!decision) {
      state.processedMessageIds.push(msg.id);
      continue;
    }

    if (decision === "approve") {
      await approve(approvalId, from, { source: "email", messageId: msg.id });
    } else {
      await deny(approvalId, from, { source: "email", messageId: msg.id });
    }

    state.processedMessageIds.push(msg.id);
    saveState(state);
  }
}

async function runOnce() {
  await maybeRunStrategy();
  await processPendingTasks();
  await processReplies();
}

async function runLoop() {
  while (true) {
    try {
      await runOnce();
    } catch (error) {
      console.error("OpenClaw ops loop error", error);
    }
    await new Promise(resolve => setTimeout(resolve, LOOP_INTERVAL_MS));
  }
}

const mode = process.argv[2];
if (mode === "--once") {
  runOnce().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  runLoop().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
