import { google } from "googleapis";
import fs from "fs";
import { env } from "../config/env.js";
import { createOpsTask } from "./opsService.js";

let gmailClient: ReturnType<typeof google.gmail> | null = null;
let labelCache: Record<string, string> | null = null;

function readRefreshToken(): string | undefined {
  if (env.GMAIL_REFRESH_TOKEN) return env.GMAIL_REFRESH_TOKEN;
  if (!env.GMAIL_REFRESH_TOKEN_FILE) return undefined;
  try {
    const raw = fs.readFileSync(env.GMAIL_REFRESH_TOKEN_FILE, "utf8");
    const data = JSON.parse(raw) as { refresh_token?: string };
    return data.refresh_token;
  } catch (error) {
    console.warn("Failed to read GMAIL_REFRESH_TOKEN_FILE", error);
    return undefined;
  }
}

function resolveGmailClient() {
  if (gmailClient) return gmailClient;

  const clientId = env.GOOGLE_OAUTH_CLIENT_ID ?? env.GMAIL_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET ?? env.GMAIL_CLIENT_SECRET;
  const refreshToken = readRefreshToken();
  const accessToken = env.GMAIL_ACCESS_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    if (!accessToken) {
      throw new Error("Gmail API credentials are not configured");
    }
  }

  const redirectUri =
    env.GMAIL_OAUTH_REDIRECT_URI ??
    env.GMAIL_REDIRECT_URI ??
    "https://developers.google.com/oauthplayground";
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({
    refresh_token: refreshToken,
    access_token: accessToken
  });

  gmailClient = google.gmail({ version: "v1", auth });
  return gmailClient;
}

function toBase64Url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildPlainTextMessage(params: {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}) {
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

async function deliverEmail(input: {
  companyId?: string;
  type:
    | "employee_invite"
    | "company_access"
    | "employee_access"
    | "company_recovery"
    | "employee_recovery"
    | "payroll_balance_alert";
  recipientEmail: string;
  subject: string;
  text: string;
  payload: Record<string, unknown>;
  queueViaOpsTask?: boolean;
}) {
  if (input.queueViaOpsTask !== false && env.HUMAN_TASKS_PROVIDER === "openclaw" && input.companyId) {
    await createOpsTask({
      companyId: input.companyId,
      type: input.type,
      recipientEmail: input.recipientEmail,
      subject: input.subject,
      payload: input.payload
    });
    return true;
  }

  if (env.EMAIL_PROVIDER_MODE && env.EMAIL_PROVIDER_MODE !== "live") {
    console.warn("Email skipped: EMAIL_PROVIDER_MODE != live", { email: input.recipientEmail, type: input.type });
    return false;
  }

  const sender =
    env.CLAWGENCY_PLATFORM_EMAIL ?? env.GMAIL_SENDER_EMAIL ?? env.EMAIL_FROM;
  if (!sender) {
    console.warn("Email skipped: GMAIL_SENDER_EMAIL or EMAIL_FROM not configured", { email: input.recipientEmail, type: input.type });
    return false;
  }
  const hasCreds =
    (env.GOOGLE_OAUTH_CLIENT_ID ?? env.GMAIL_CLIENT_ID) &&
    (env.GOOGLE_OAUTH_CLIENT_SECRET ?? env.GMAIL_CLIENT_SECRET) &&
    (readRefreshToken() || env.GMAIL_ACCESS_TOKEN);
  if (!hasCreds) {
    console.warn("Email skipped: Gmail API credentials not configured", { email: input.recipientEmail, type: input.type });
    return false;
  }

  const raw = buildPlainTextMessage({
    from: sender,
    to: input.recipientEmail,
    subject: input.subject,
    text: input.text,
    replyTo: env.CLAWGENCY_PLATFORM_EMAIL ?? undefined
  });

  const gmail = resolveGmailClient();
  const label = env.GMAIL_REPLY_LABEL;
  const labelId = label ? await resolveLabelId(label) : null;
  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      ...(labelId ? { labelIds: [labelId] } : {})
    }
  });

  return true;
}

async function resolveLabelId(labelName: string) {
  if (!labelName) return null;
  if (labelCache && labelCache[labelName]) return labelCache[labelName];

  const gmail = resolveGmailClient();
  const res = await gmail.users.labels.list({ userId: "me" });
  const labels = res.data.labels ?? [];
  labelCache = labelCache ?? {};
  for (const label of labels) {
    if (!label.name || !label.id) continue;
    labelCache[label.name] = label.id;
  }
  return labelCache[labelName] ?? null;
}

export async function sendEmployeeInvite(input: {
  email: string;
  activationToken: string;
  companyId?: string;
  employeeId?: string;
  activationUrl?: string;
}) {
  const inviteUrl = input.activationUrl ?? `${env.APP_BASE_URL}/employees/activate?token=${input.activationToken}`;
  return deliverEmail({
    companyId: input.companyId,
    type: "employee_invite",
    recipientEmail: input.email,
    subject: "Activate your FlowPay account",
    text: [
      "You have been invited to FlowPay.",
      `Employee ID: ${input.employeeId ?? "Pending assignment"}`,
      `Activate your account here: ${inviteUrl}`
    ].join("\n"),
    payload: {
      employeeId: input.employeeId ?? null,
      email: input.email,
      activationToken: input.activationToken,
      activationUrl: inviteUrl,
      followupSuggestedDays: [1, 3, 7]
    }
  });
}

export async function sendCompanyRecoveryEmail(input: {
  companyId: string;
  companyName: string;
  email: string;
  resetToken: string;
  resetUrl?: string;
}) {
  const resetUrl = input.resetUrl ?? `${env.APP_BASE_URL}/recover/company?token=${input.resetToken}`;
  return deliverEmail({
    companyId: input.companyId,
    type: "company_recovery",
    recipientEmail: input.email,
    subject: "Reset your FlowPay company PIN",
    text: [
      `A PIN reset was requested for ${input.companyName}.`,
      `Company ID: ${input.companyId}`,
      `Use this link to set a new company PIN: ${resetUrl}`,
      "",
      "This link expires in 60 minutes."
    ].join("\n"),
    payload: {
      companyId: input.companyId,
      companyName: input.companyName,
      email: input.email,
      resetToken: input.resetToken,
      resetUrl
    }
  });
}

export async function sendEmployeeRecoveryEmail(input: {
  companyId?: string;
  employeeId: string;
  fullName: string;
  email: string;
  resetToken: string;
  resetUrl?: string;
}) {
  const resetUrl = input.resetUrl ?? `${env.APP_BASE_URL}/recover/employee?token=${input.resetToken}`;
  return deliverEmail({
    companyId: input.companyId,
    type: "employee_recovery",
    recipientEmail: input.email,
    subject: "Reset your FlowPay employee password",
    text: [
      `A password reset was requested for ${input.fullName}.`,
      `Employee ID: ${input.employeeId}`,
      `Use this link to set a new employee password: ${resetUrl}`,
      "",
      "This link expires in 60 minutes."
    ].join("\n"),
    payload: {
      employeeId: input.employeeId,
      fullName: input.fullName,
      email: input.email,
      resetToken: input.resetToken,
      resetUrl
    }
  });
}

export async function sendCompanyAccessEmail(input: {
  companyId: string;
  companyName: string;
  email: string;
  treasuryAddress?: string | null;
}) {
  return deliverEmail({
    companyId: input.companyId,
    type: "company_access",
    recipientEmail: input.email,
    subject: "Your FlowPay company workspace is ready",
    text: [
      `Your FlowPay employer workspace for ${input.companyName} is ready.`,
      `Company ID: ${input.companyId}`,
      ...(input.treasuryAddress ? [`Treasury wallet: ${input.treasuryAddress}`] : []),
      `Open FlowPay here: ${env.APP_BASE_URL}`
    ].join("\n"),
    payload: {
      companyId: input.companyId,
      companyName: input.companyName,
      treasuryAddress: input.treasuryAddress ?? null,
      email: input.email
    }
  });
}

export async function sendEmployeeAccessEmail(input: {
  companyId?: string;
  employeeId: string;
  fullName: string;
  email: string;
  walletAddress?: string | null;
}) {
  return deliverEmail({
    companyId: input.companyId,
    type: "employee_access",
    recipientEmail: input.email,
    subject: "Your FlowPay employee workspace is ready",
    text: [
      `Your FlowPay employee workspace is ready for ${input.fullName}.`,
      `Employee ID: ${input.employeeId}`,
      ...(input.walletAddress ? [`Wallet address: ${input.walletAddress}`] : []),
      `Open FlowPay here: ${env.APP_BASE_URL}`
    ].join("\n"),
    payload: {
      companyId: input.companyId ?? null,
      employeeId: input.employeeId,
      fullName: input.fullName,
      walletAddress: input.walletAddress ?? null,
      email: input.email
    }
  });
}

export async function sendCompanyPayrollBalanceAlert(input: {
  companyId: string;
  companyName: string;
  email: string;
  nextPayrollAt: string;
  payrollMonthLabel: string;
  hoursToPayroll: number;
  requiredPayrollAmount: number;
  treasuryBalance: number;
  shortfall: number;
  currency: string;
}) {
  return deliverEmail({
    companyId: input.companyId,
    type: "payroll_balance_alert",
    recipientEmail: input.email,
    subject: "FlowPay payroll funding alert",
    text: [
      `Payroll is approaching for ${input.companyName}.`,
      `Payroll month: ${input.payrollMonthLabel}`,
      `Scheduled payroll time: ${input.nextPayrollAt}`,
      `Hours until payroll: ${input.hoursToPayroll.toFixed(2)}`,
      `Required payroll funding: ${input.requiredPayrollAmount.toFixed(6)} ${input.currency}`,
      `Current treasury balance: ${input.treasuryBalance.toFixed(6)} ${input.currency}`,
      `Funding shortfall: ${input.shortfall.toFixed(6)} ${input.currency}`,
      "",
      "Please fund the treasury before the scheduled payroll run to avoid missed salary disbursements."
    ].join("\n"),
    payload: {
      companyId: input.companyId,
      companyName: input.companyName,
      email: input.email,
      nextPayrollAt: input.nextPayrollAt,
      payrollMonthLabel: input.payrollMonthLabel,
      hoursToPayroll: input.hoursToPayroll,
      requiredPayrollAmount: input.requiredPayrollAmount,
      treasuryBalance: input.treasuryBalance,
      shortfall: input.shortfall,
      currency: input.currency
    },
    queueViaOpsTask: false
  });
}
