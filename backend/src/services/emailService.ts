import nodemailer from "nodemailer";
import { env } from "../config/env.js";

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!env.SMTP_URL) {
    throw new Error("SMTP_URL is not configured");
  }
  transporter = nodemailer.createTransport(env.SMTP_URL);
  return transporter;
}

export async function sendEmployeeInvite(email: string, activationToken: string) {
  if (!env.SMTP_URL || !env.EMAIL_FROM) {
    console.warn("Email invite skipped: SMTP_URL or EMAIL_FROM not configured", { email });
    return;
  }
  const inviteUrl = `${env.APP_BASE_URL}/employees/activate?token=${activationToken}`;
  const message = {
    from: env.EMAIL_FROM,
    to: email,
    subject: "Activate your FlowPay account",
    text: `You have been invited to FlowPay. Activate your account here: ${inviteUrl}`
  };

  const transport = getTransporter();
  await transport.sendMail(message);
}
