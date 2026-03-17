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

if (!MASTER_KEY) {
  console.error("MASTER_KEY is required");
  process.exit(1);
}
if (!EMAIL_FROM) {
  console.error("EMAIL_FROM or CLAWGENCY_PLATFORM_EMAIL is required");
  process.exit(1);
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
    lines.push(`Activate here: ${payload.activationUrl ?? ""}`);
  } else if (task.type === "treasury_topup") {
    lines.push(`Treasury shortfall: ${payload.shortfall ?? 0}`);
    lines.push(`Balance: ${payload.balanceEth ?? 0}`);
    lines.push(`Monthly payroll: ${payload.monthlyPayroll ?? 0}`);
    lines.push(`Treasury address: ${payload.treasuryAddress ?? ""}`);
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
