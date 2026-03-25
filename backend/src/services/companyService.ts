import { pool } from "../db/pool.js";
import bcrypt from "bcryptjs";
import { createTreasuryWallet } from "./walletService.js";
import { startDepositWatcher } from "./depositWatcher.js";
import { sendCompanyAccessEmail } from "./emailService.js";
import { normalizeSettlementChain } from "../utils/settlement.js";

export async function registerCompany(input: {
  name: string;
  email: string;
  accessPin: string;
  settlementChain?: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const accessPinHash = await bcrypt.hash(input.accessPin, 12);
    const companyResult = await client.query(
      `INSERT INTO companies (name, email, access_pin_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [input.name, input.email, accessPinHash]
    );
    const company = companyResult.rows[0];
    const wallet = await createTreasuryWallet(
      company.id,
      client,
      normalizeSettlementChain(input.settlementChain, "ethereum")
    );
    await client.query("COMMIT");

    await startDepositWatcher(wallet.id, company.id, wallet.wallet_address);
    await sendCompanyAccessEmail({
      companyId: company.id,
      companyName: company.name,
      email: company.email,
      treasuryAddress: wallet.wallet_address
    });

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
