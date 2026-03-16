import WDK from "@tetherto/wdk";
import WalletManagerEvm, {
  WalletAccountEvm,
  WalletAccountReadOnlyEvm
} from "@tetherto/wdk-wallet-evm";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db/pool.js";
import { env } from "../config/env.js";
import { encryptSecret, decryptSecret } from "../crypto/crypto.js";
import { parseAmount, formatAmount } from "../utils/amounts.js";
import { ApiError } from "../utils/errors.js";
import type { PoolClient } from "pg";
import { startDepositWatcher } from "./depositWatcher.js";
import { generateSeedPhrase } from "../utils/seed.js";

const rpcUrl = env.RPC_URL.replace("{WDK_API_KEY}", env.WDK_API_KEY);
const transferMaxFee = BigInt(env.WDK_TRANSFER_MAX_FEE);

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<any>;
};

function buildWdk(seedPhrase: string) {
  const wdk = new WDK(seedPhrase);
  wdk.registerWallet("ethereum", WalletManagerEvm, {
    provider: rpcUrl,
    transferMaxFee
  });
  return wdk;
}

async function getWalletRecord(walletId: string) {
  const result = await db.query(
    "SELECT id, wallet_id, wallet_address, encrypted_seed, chain FROM wallets WHERE id = $1",
    [walletId]
  );
  if (result.rowCount === 0) {
    throw new ApiError(404, "Wallet not found");
  }
  return result.rows[0];
}

async function createWallet(ownerType: "company" | "employee", ownerId: string, client?: Queryable) {
  const seedPhrase = generateSeedPhrase();
  const wdk = buildWdk(seedPhrase);
  const account = (await wdk.getAccount("ethereum", 0)) as WalletAccountEvm;
  const walletAddress = await account.getAddress();
  const encryptedSeed = encryptSecret(seedPhrase);
  const walletExternalId = uuidv4();
  const queryable = client ?? db;

  const insert = await queryable.query(
    "INSERT INTO wallets (owner_type, owner_id, wallet_address, wallet_id, encrypted_seed, chain) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, wallet_id, wallet_address",
    [ownerType, ownerId, walletAddress, walletExternalId, encryptedSeed, "sepolia"]
  );

  return insert.rows[0] as {
    id: string;
    wallet_id: string;
    wallet_address: string;
  };
}

export async function createTreasuryWallet(companyId: string, client?: PoolClient) {
  const wallet = await createWallet("company", companyId, client ?? undefined);
  const queryable = client ?? db;
  await queryable.query("UPDATE companies SET treasury_wallet_id = $1 WHERE id = $2", [wallet.id, companyId]);
  return wallet;
}

export async function createEmployeeWallet(employeeId: string, client?: PoolClient) {
  const wallet = await createWallet("employee", employeeId, client ?? undefined);
  const queryable = client ?? db;
  await queryable.query("UPDATE employees SET wallet_id = $1 WHERE id = $2", [wallet.id, employeeId]);
  return wallet;
}

export async function getWalletBalance(walletId: string) {
  const wallet = await getWalletRecord(walletId);
  const account = new WalletAccountReadOnlyEvm(wallet.wallet_address, { provider: rpcUrl });
  const balanceWei = await account.getBalance();
  return {
    balanceWei: balanceWei.toString(),
    balanceEth: formatAmount(balanceWei),
    walletAddress: wallet.wallet_address
  };
}

export async function sendTransaction(
  fromWalletId: string,
  toAddress: string,
  amountEth: string | number,
  type: "payroll" | "loan_disbursement" | "investment" | "treasury_allocation" | "emi_repayment"
) {
  const wallet = await getWalletRecord(fromWalletId);
  const amountWei = parseAmount(amountEth);
  const maxTx = parseFloat(env.MAX_TX_AMOUNT);
  if (parseFloat(amountEth.toString()) > maxTx) {
    throw new ApiError(400, `Transfer exceeds max transaction limit (${maxTx})`);
  }

  const seedPhrase = decryptSecret(wallet.encrypted_seed);
  const wdk = buildWdk(seedPhrase);
  const account = (await wdk.getAccount("ethereum", 0)) as WalletAccountEvm;

  const balanceWei = await account.getBalance();
  if (balanceWei < amountWei) {
    throw new ApiError(400, "Insufficient wallet balance");
  }

  const txResult = await account.sendTransaction({
    to: toAddress,
    value: amountWei
  });

  await db.query(
    "INSERT INTO transactions (wallet_id, type, amount, tx_hash) VALUES ($1, $2, $3, $4)",
    [wallet.id, type, amountEth.toString(), txResult?.hash ?? null]
  );

  return {
    txHash: txResult?.hash ?? null,
    amountEth: amountEth.toString(),
    from: await account.getAddress(),
    to: toAddress
  };
}

export async function listenForDeposits(walletId: string) {
  const result = await db.query(
    `SELECT w.id as wallet_id, w.wallet_address, c.id as company_id
     FROM wallets w
     JOIN companies c ON c.treasury_wallet_id = w.id
     WHERE w.id = $1`,
    [walletId]
  );
  if (result.rowCount === 0) {
    throw new ApiError(404, "Treasury wallet not found for deposit listener");
  }
  const row = result.rows[0];
  await startDepositWatcher(row.wallet_id, row.company_id, row.wallet_address);
  return { status: "listening" };
}
