import { env } from "../config/env.js";
import { createOpsTaskIfNotRecent, parseAdminEmails } from "./opsService.js";

export type NotificationSeverity = "info" | "success" | "warning" | "critical";

export type AutomationNotificationInput = {
  title: string;
  message: string;
  severity: NotificationSeverity;
  companyId?: string;
  payload?: Record<string, unknown>;
  force?: boolean;
};

type DispatchResult = {
  delivered: boolean;
  channels: string[];
  skipped: boolean;
  errors: string[];
};

const cooldownByFingerprint = new Map<string, number>();

function parseMinutes(value: string, fallback: number): number {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function makeFingerprint(input: AutomationNotificationInput): string {
  const scope = input.companyId ?? "global";
  return `${scope}::${input.severity}::${input.title}`.toLowerCase();
}

function shouldSkipByCooldown(input: AutomationNotificationInput): boolean {
  if (input.force) {
    return false;
  }
  const cooldownMinutes = parseMinutes(env.OPS_ALERT_COOLDOWN_MIN, 30);
  const cooldownMs = cooldownMinutes * 60 * 1000;
  const fingerprint = makeFingerprint(input);
  const lastSentAt = cooldownByFingerprint.get(fingerprint);
  if (lastSentAt && Date.now() - lastSentAt < cooldownMs) {
    return true;
  }
  cooldownByFingerprint.set(fingerprint, Date.now());
  return false;
}

function parseNotificationEmails(): string[] {
  const fromEnv = env.OPS_NOTIFICATION_EMAILS?.trim();
  if (!fromEnv) {
    return parseAdminEmails();
  }
  const emails = fromEnv
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(emails));
}

function formatPayload(payload?: Record<string, unknown>): string {
  if (!payload || Object.keys(payload).length === 0) {
    return "";
  }
  return `\n\nContext:\n${JSON.stringify(payload, null, 2)}`;
}

async function sendSlack(input: AutomationNotificationInput): Promise<void> {
  if (!env.OPS_SLACK_WEBHOOK_URL) {
    return;
  }

  const severityIcon =
    input.severity === "critical"
      ? ":rotating_light:"
      : input.severity === "warning"
        ? ":warning:"
        : input.severity === "success"
          ? ":white_check_mark:"
          : ":information_source:";
  const text = `${severityIcon} *${input.title}*\n${input.message}${formatPayload(input.payload)}`;

  const response = await fetch(env.OPS_SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed (${response.status})`);
  }
}

async function sendTelegram(input: AutomationNotificationInput): Promise<void> {
  if (!env.OPS_TELEGRAM_BOT_TOKEN || !env.OPS_TELEGRAM_CHAT_ID) {
    return;
  }

  const severityPrefix =
    input.severity === "critical"
      ? "CRITICAL"
      : input.severity === "warning"
        ? "WARNING"
        : input.severity === "success"
          ? "SUCCESS"
          : "INFO";
  const text = `[${severityPrefix}] ${input.title}\n${input.message}${formatPayload(input.payload)}`;
  const url = `https://api.telegram.org/bot${env.OPS_TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.OPS_TELEGRAM_CHAT_ID,
      text
    })
  });

  if (!response.ok) {
    throw new Error(`Telegram notification failed (${response.status})`);
  }
}

async function queueEmailAlerts(input: AutomationNotificationInput): Promise<number> {
  if (!input.companyId) {
    return 0;
  }
  const recipients = parseNotificationEmails();
  if (recipients.length === 0) {
    return 0;
  }

  let created = 0;
  for (const recipient of recipients) {
    const result = await createOpsTaskIfNotRecent({
      companyId: input.companyId,
      type: "notification_alert",
      recipientEmail: recipient,
      subject: `[FlowPay ${input.severity.toUpperCase()}] ${input.title}`,
      payload: {
        severity: input.severity,
        title: input.title,
        message: input.message,
        payload: input.payload ?? {},
        generatedAt: new Date().toISOString()
      },
      dedupeWindowMinutes: parseMinutes(env.AUTOMATION_DEDUPE_WINDOW_MIN, 240)
    });
    if (result.created) {
      created += 1;
    }
  }

  return created;
}

export async function sendAutomationNotification(
  input: AutomationNotificationInput
): Promise<DispatchResult> {
  if (shouldSkipByCooldown(input)) {
    return { delivered: false, channels: [], skipped: true, errors: [] };
  }

  const channels: string[] = [];
  const errors: string[] = [];

  try {
    await sendSlack(input);
    if (env.OPS_SLACK_WEBHOOK_URL) {
      channels.push("slack");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Slack delivery failed");
  }

  try {
    await sendTelegram(input);
    if (env.OPS_TELEGRAM_BOT_TOKEN && env.OPS_TELEGRAM_CHAT_ID) {
      channels.push("telegram");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Telegram delivery failed");
  }

  try {
    const queuedEmails = await queueEmailAlerts(input);
    if (queuedEmails > 0) {
      channels.push("email");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Email queueing failed");
  }

  return {
    delivered: channels.length > 0,
    channels,
    skipped: false,
    errors
  };
}
