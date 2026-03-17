import crypto from "crypto";
import { createRequire } from "module";

const mnemonic = process.env.ADMIN_SEED_PHRASE?.trim();
const masterKey = process.env.MASTER_KEY;

if (!mnemonic) {
  console.error("Missing ADMIN_SEED_PHRASE env var.");
  process.exit(1);
}
if (!masterKey || masterKey.length < 32) {
  console.error("Missing MASTER_KEY env var (min 32 chars).");
  process.exit(1);
}

const require = createRequire(import.meta.url);

function encryptLegacy(plainText: string, passkey: string): string {
  const key = crypto.createHash("sha256").update(passkey).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, encrypted, tag].map((chunk) => chunk.toString("base64")).join(":");
}

async function main() {
  try {
    const mod = require("@tetherto/wdk-secret-manager");
    const base = mod?.default ?? mod;
    const WdkSecretManager = base?.WdkSecretManager ?? mod?.WdkSecretManager;
    const wdkSaltGenerator = base?.wdkSaltGenerator ?? mod?.wdkSaltGenerator;
    if (!WdkSecretManager || !wdkSaltGenerator?.generate) {
      throw new Error("WDK Secret Manager unavailable");
    }
    const salt = wdkSaltGenerator.generate();
    const sm = new WdkSecretManager(masterKey, salt);
    try {
      const entropy = sm.mnemonicToEntropy(mnemonic);
      const { encryptedEntropy } = await sm.generateAndEncrypt(entropy);
      const payload = [
        "sm:v1",
        salt.toString("base64"),
        Buffer.from(encryptedEntropy).toString("base64")
      ].join(":");
      console.log(`ADMIN_SEED_PAYLOAD=${payload}`);
      return;
    } finally {
      sm.dispose();
    }
  } catch {
    const payload = encryptLegacy(mnemonic, masterKey);
    console.log(`ADMIN_SEED_PAYLOAD=${payload}`);
  }
}

main().catch((error) => {
  console.error("Failed to encrypt admin seed:", error?.message ?? error);
  process.exit(1);
});
