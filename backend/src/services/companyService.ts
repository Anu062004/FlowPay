import { pool } from "../db/pool.js";
import { createTreasuryWallet } from "./walletService.js";
import { startDepositWatcher } from "./depositWatcher.js";

export async function registerCompany(name: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const companyResult = await client.query(
      "INSERT INTO companies (name) VALUES ($1) RETURNING id, name, created_at",
      [name]
    );
    const company = companyResult.rows[0];
    const wallet = await createTreasuryWallet(company.id, client);
    await client.query("COMMIT");

    await startDepositWatcher(wallet.id, company.id, wallet.wallet_address);

    return {
      company,
      treasury_wallet: wallet
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
