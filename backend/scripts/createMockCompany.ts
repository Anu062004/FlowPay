import { registerCompany } from "../src/services/companyService.js";
import { stopDepositWatcher } from "../src/services/depositWatcher.js";
import { pool } from "../src/db/pool.js";

const name = process.argv[2] ?? "Mock Company";

const result = await registerCompany(name);

await stopDepositWatcher(result.treasury_wallet.id);
await pool.end();

console.log(JSON.stringify({
  companyId: result.company.id,
  treasuryAddress: result.treasury_wallet.wallet_address
}, null, 2));
