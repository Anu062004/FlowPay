import crypto from "crypto";
import { createRequire } from "module";
import { env } from "../config/env.js";

const legacyKey = crypto.createHash("sha256").update(env.MASTER_KEY).digest();
const SM_PREFIX = "sm:v1";
const require = createRequire(import.meta.url);

type SecretManagerModule = {
  WdkSecretManager: new (passkey: string | Buffer, salt?: Buffer) => {
    generateAndEncrypt: (payload?: Buffer) => Promise<{ encryptedEntropy: Buffer }>;
    decrypt: (payload: Buffer) => Buffer;
    entropyToMnemonic: (entropy: Buffer) => string;
    mnemonicToEntropy: (seedPhrase: string) => Buffer;
    dispose: () => void;
  };
  wdkSaltGenerator: { generate: () => Buffer };
};

function resolveSecretManager(): SecretManagerModule | null {
  try {
    const mod = require("@tetherto/wdk-secret-manager");
    const base = mod?.default ?? mod;
    const WdkSecretManager = base?.WdkSecretManager ?? mod?.WdkSecretManager;
    const wdkSaltGenerator = base?.wdkSaltGenerator ?? mod?.wdkSaltGenerator;
    if (!WdkSecretManager || !wdkSaltGenerator?.generate) return null;
    return { WdkSecretManager, wdkSaltGenerator };
  } catch {
    return null;
  }
}

function encryptLegacy(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", legacyKey, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, encrypted, tag].map((chunk) => chunk.toString("base64")).join(":");
}

export async function encryptMnemonicWithPasskey(
  plainText: string,
  passkey: string
): Promise<string> {
  const secretManager = resolveSecretManager();
  if (!secretManager) {
    return encryptLegacy(plainText);
  }
  const salt = secretManager.wdkSaltGenerator.generate();
  const sm = new secretManager.WdkSecretManager(passkey, salt);
  try {
    const entropy = sm.mnemonicToEntropy(plainText);
    const { encryptedEntropy } = await sm.generateAndEncrypt(entropy);
    return [
      SM_PREFIX,
      salt.toString("base64"),
      Buffer.from(encryptedEntropy).toString("base64")
    ].join(":");
  } finally {
    sm.dispose();
  }
}

export function decryptMnemonicWithPasskey(payload: string, passkey: string): string {
  if (payload.startsWith(`${SM_PREFIX}:`)) {
    const [, saltB64, encryptedB64] = payload.split(":");
    if (!saltB64 || !encryptedB64) {
      throw new Error("Invalid secret payload");
    }
    const secretManager = resolveSecretManager();
    if (!secretManager) {
      throw new Error("WDK Secret Manager unavailable for SM payloads");
    }
    const salt = Buffer.from(saltB64, "base64");
    const encrypted = Buffer.from(encryptedB64, "base64");
    const sm = new secretManager.WdkSecretManager(passkey, salt);
    try {
      const entropy = sm.decrypt(encrypted);
      return sm.entropyToMnemonic(entropy);
    } finally {
      sm.dispose();
    }
  }

  const [ivB64, encryptedB64, tagB64] = payload.split(":");
  if (!ivB64 || !encryptedB64 || !tagB64) {
    throw new Error("Invalid encrypted payload");
  }
  const iv = Buffer.from(ivB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", legacyKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export async function encryptSecret(plainText: string): Promise<string> {
  return encryptMnemonicWithPasskey(plainText, env.MASTER_KEY);
}

export function decryptSecret(payload: string): string {
  return decryptMnemonicWithPasskey(payload, env.MASTER_KEY);
}
