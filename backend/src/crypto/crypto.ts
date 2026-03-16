import crypto from "crypto";
import { env } from "../config/env.js";

const key = crypto.createHash("sha256").update(env.MASTER_KEY).digest();

export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), encrypted.toString("base64"), tag.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivB64, encryptedB64, tagB64] = payload.split(":");
  if (!ivB64 || !encryptedB64 || !tagB64) {
    throw new Error("Invalid encrypted payload");
  }
  const iv = Buffer.from(ivB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
