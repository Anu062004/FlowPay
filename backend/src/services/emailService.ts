import { google } from "googleapis";
import { env } from "../config/env.js";

let gmailClient: ReturnType<typeof google.gmail> | null = null;

function resolveGmailClient() {
  if (gmailClient) return gmailClient;

  const clientId = env.GMAIL_CLIENT_ID;
  const clientSecret = env.GMAIL_CLIENT_SECRET;
  const refreshToken = env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Gmail API credentials are not configured");
  }

  const redirectUri =
    env.GMAIL_REDIRECT_URI ?? "https://developers.google.com/oauthplayground";
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({ refresh_token: refreshToken });

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
}) {
  const lines = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    params.text
  ];
  return toBase64Url(lines.join("\r\n"));
}

export async function sendEmployeeInvite(email: string, activationToken: string) {
  const sender = env.GMAIL_SENDER_EMAIL ?? env.EMAIL_FROM;
  if (!sender) {
    console.warn("Email invite skipped: GMAIL_SENDER_EMAIL or EMAIL_FROM not configured", { email });
    return;
  }
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    console.warn("Email invite skipped: Gmail API credentials not configured", { email });
    return;
  }

  const inviteUrl = `${env.APP_BASE_URL}/employees/activate?token=${activationToken}`;
  const raw = buildPlainTextMessage({
    from: sender,
    to: email,
    subject: "Activate your FlowPay account",
    text: `You have been invited to FlowPay. Activate your account here: ${inviteUrl}`
  });

  const gmail = resolveGmailClient();
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw }
  });
}
