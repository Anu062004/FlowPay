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

  if (env.HUMAN_TASKS_PROVIDER === "openclaw") {
    if (!input.companyId) {
      console.warn("OpenClaw invite skipped: missing companyId", { email: input.email });
      return;
    }
    await createOpsTask({
      companyId: input.companyId,
      type: "employee_invite",
      recipientEmail: input.email,
      subject: "Activate your FlowPay account",
      payload: {
        employeeId: input.employeeId ?? null,
        email: input.email,
        activationToken: input.activationToken,
        activationUrl: inviteUrl,
        followupSuggestedDays: [1, 3, 7]
      }
    });
    return;
  }

  if (env.EMAIL_PROVIDER_MODE && env.EMAIL_PROVIDER_MODE !== "live") {
    console.warn("Email invite skipped: EMAIL_PROVIDER_MODE != live", { email: input.email });
    return;
  }

  const sender =
    env.CLAWGENCY_PLATFORM_EMAIL ?? env.GMAIL_SENDER_EMAIL ?? env.EMAIL_FROM;
  if (!sender) {
    console.warn("Email invite skipped: GMAIL_SENDER_EMAIL or EMAIL_FROM not configured", { email: input.email });
    return;
  }
  const hasCreds =
    (env.GOOGLE_OAUTH_CLIENT_ID ?? env.GMAIL_CLIENT_ID) &&
    (env.GOOGLE_OAUTH_CLIENT_SECRET ?? env.GMAIL_CLIENT_SECRET) &&
    (readRefreshToken() || env.GMAIL_ACCESS_TOKEN);
  if (!hasCreds) {
    console.warn("Email invite skipped: Gmail API credentials not configured", { email: input.email });
    return;
  }

  const raw = buildPlainTextMessage({
    from: sender,
    to: input.email,
    subject: "Activate your FlowPay account",
    text: `You have been invited to FlowPay. Activate your account here: ${inviteUrl}`,
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
}
