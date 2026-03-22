import WDK from "@tetherto/wdk";
import WalletManagerEvm, { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";
import WalletManagerTon from "@tetherto/wdk-wallet-ton";
import WalletManagerTron from "@tetherto/wdk-wallet-tron";
import WalletManagerBtc from "@tetherto/wdk-wallet-btc";
import WalletManagerSolana from "@tetherto/wdk-wallet-solana";
import { Contract } from "ethers";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db/pool.js";
import { env } from "../config/env.js";
import { encryptSecret, decryptSecret } from "../crypto/crypto.js";
import { parseAmount, formatAmount, parseTokenAmount, formatTokenAmount } from "../utils/amounts.js";
import { ApiError } from "../utils/errors.js";
import type { PoolClient } from "pg";
import { startDepositWatcher } from "./depositWatcher.js";
import { generateSeedPhrase } from "../utils/seed.js";
import { getTokenBalance as getIndexedTokenBalance } from "./indexerService.js";
import { getRoundRobinRpcUrl, withRpcFailover } from "./rpcService.js";

const transferMaxFee = BigInt(env.WDK_TRANSFER_MAX_FEE);
const minimumNativeGasReserveWei = parseAmount(env.MIN_NATIVE_GAS_RESERVE_ETH);
const SUPPORTED_EVM_CHAINS = new Set(["ethereum", "sepolia"]);
const EMPLOYEE_LEDGER_MIRROR_TYPES = new Set(["payroll", "loan_disbursement", "emi_repayment"]);
export const nativeTransferMaxFee = transferMaxFee;
export const minimumGasReserveWei = minimumNativeGasReserveWei;
const ERC20_ABI = ["function balanceOf(address owner) view returns (uint256)"];

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<any>;
};

function normalizeChain(chain: string) {
  return chain.toLowerCase();
}

function requireSupportedEvmChain(chain: string, transferType: "token" | "native") {
  const normalized = normalizeChain(chain);
  if (!SUPPORTED_EVM_CHAINS.has(normalized)) {
    const label = transferType === "token" ? "Token" : "Native";
    throw new ApiError(400, `${label} transfers are only supported on EVM chains`);
  }
  return normalized;
}

function mapWalletDecryptError(error: unknown): ApiError | null {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("Unsupported state or unable to authenticate data") ||
    message.includes("Invalid encrypted payload") ||
    message.includes("Invalid seed")
  ) {
    return new ApiError(
      400,
      "Treasury wallet cannot be decrypted with the current MASTER_KEY. Restore the original MASTER_KEY or recreate/fund a new treasury wallet."
    );
  }
  return null;
}

function buildWdk(seedPhrase: string) {
  const rpcUrl = getRoundRobinRpcUrl();
  const wdk = new WDK(seedPhrase);
  wdk.registerWallet("ethereum", WalletManagerEvm, {
    provider: rpcUrl,
    transferMaxFee
  });
  wdk.registerWallet("sepolia", WalletManagerEvm, {
    provider: rpcUrl,
    transferMaxFee
  });
  if (env.TON_RPC_URL) {
    wdk.registerWallet("ton", WalletManagerTon as any, { provider: env.TON_RPC_URL } as any);
  }
  if (env.TRON_RPC_URL) {
    wdk.registerWallet("tron", WalletManagerTron as any, { provider: env.TRON_RPC_URL } as any);
  }
  if (env.BTC_RPC_URL) {
    wdk.registerWallet("bitcoin", WalletManagerBtc as any, { provider: env.BTC_RPC_URL } as any);
  }
  if (env.SOLANA_RPC_URL) {
    wdk.registerWallet("solana", WalletManagerSolana as any, { provider: env.SOLANA_RPC_URL } as any);
  }
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

async function insertTransactionRecord(params: {
  walletId: string;
  type: "deposit" | "payroll" | "loan_disbursement" | "emi_repayment" | "withdrawal" | "investment" | "treasury_allocation";
  amount: string;
  txHash: string | null;
  tokenSymbol: string;
  createdAt?: Date;
}) {
  const { walletId, type, amount, txHash, tokenSymbol, createdAt } = params;
  if (createdAt) {
    await db.query(
      "INSERT INTO transactions (wallet_id, type, amount, tx_hash, token_symbol, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [walletId, type, amount, txHash, tokenSymbol, createdAt]
    );
    return;
  }

  await db.query(
    "INSERT INTO transactions (wallet_id, type, amount, tx_hash, token_symbol) VALUES ($1, $2, $3, $4, $5)",
    [walletId, type, amount, txHash, tokenSymbol]
  );
}

async function mirrorEmployeeLedgerEntry(params: {
  recipientWalletId?: string | null;
  type: "payroll" | "loan_disbursement" | "investment" | "treasury_allocation" | "emi_repayment" | "withdrawal";
  amount: string;
  txHash: string | null;
  tokenSymbol: string;
  createdAt: Date;
}) {
  const { recipientWalletId, type, amount, txHash, tokenSymbol, createdAt } = params;
  if (!recipientWalletId || !EMPLOYEE_LEDGER_MIRROR_TYPES.has(type)) {
    return;
  }

  await insertTransactionRecord({
    walletId: recipientWalletId,
    type,
    amount,
    txHash,
    tokenSymbol,
    createdAt
  });
}

async function createWallet(ownerType: "company" | "employee", ownerId: string, client?: Queryable) {
  let seedPhrase = generateSeedPhrase();
  const wdk = buildWdk(seedPhrase);
  const chain = normalizeChain(env.DEFAULT_CHAIN || "ethereum");
  const account = (await wdk.getAccount(chain, 0)) as unknown as WalletAccountEvm;
  try {
    const walletAddress = await account.getAddress();
    const encryptedSeed = await encryptSecret(seedPhrase);
    const walletExternalId = uuidv4();
    const queryable = client ?? db;

    const insert = await queryable.query(
      "INSERT INTO wallets (owner_type, owner_id, wallet_address, wallet_id, encrypted_seed, chain) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, wallet_id, wallet_address",
      [ownerType, ownerId, walletAddress, walletExternalId, encryptedSeed, chain]
    );

    return insert.rows[0] as {
      id: string;
      wallet_id: string;
      wallet_address: string;
    };
  } finally {
    seedPhrase = "";
    account.dispose();
  }
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
  const nativeGasBalance = await withRpcFailover("wallet native gas balance", async (provider) =>
    provider.getBalance(wallet.wallet_address)
  );

  if (env.TREASURY_TOKEN_ADDRESS && env.TREASURY_TOKEN_SYMBOL) {
    const token = env.TREASURY_TOKEN_SYMBOL.toLowerCase();
    const blockchain = env.TREASURY_TOKEN_BLOCKCHAIN;
    const indexed = await getIndexedTokenBalance({
      blockchain,
      token,
      address: wallet.wallet_address
    });
    const decimals = parseInt(env.TREASURY_TOKEN_DECIMALS, 10);
    const indexedAmount = indexed?.amount ?? "0";
    let amountRaw = 0n;
    if (typeof indexedAmount === "string") {
      // Indexer may return decimal strings (for example "0.0"), so parse via token decimals.
      amountRaw = parseTokenAmount(indexedAmount, decimals);
    } else {
      amountRaw = BigInt(indexedAmount);
    }
    return {
      balanceWei: amountRaw.toString(),
      balanceEth: formatTokenAmount(amountRaw, decimals),
      walletAddress: wallet.wallet_address,
      tokenSymbol: env.TREASURY_TOKEN_SYMBOL,
      nativeGasBalanceWei: nativeGasBalance.toString(),
      nativeGasBalanceEth: formatAmount(nativeGasBalance),
      minimumGasReserveWei: minimumNativeGasReserveWei.toString(),
      minimumGasReserveEth: formatAmount(minimumNativeGasReserveWei),
      gasReserveSatisfied: nativeGasBalance >= minimumNativeGasReserveWei
    };
  }

  const balanceWei = nativeGasBalance;
  return {
    balanceWei: balanceWei.toString(),
    balanceEth: formatAmount(balanceWei),
    walletAddress: wallet.wallet_address,
    tokenSymbol: "ETH",
    nativeGasBalanceWei: nativeGasBalance.toString(),
    nativeGasBalanceEth: formatAmount(nativeGasBalance),
    minimumGasReserveWei: minimumNativeGasReserveWei.toString(),
    minimumGasReserveEth: formatAmount(minimumNativeGasReserveWei),
    gasReserveSatisfied: nativeGasBalance >= minimumNativeGasReserveWei
  };
}

export async function getTokenBalance(walletId: string, tokenAddress: string, decimals = 18) {
  const wallet = await getWalletRecord(walletId);
  const balance = await withRpcFailover("wallet token balance", async (provider) => {
    const token = new Contract(tokenAddress, ERC20_ABI, provider);
    return (await token.balanceOf(wallet.wallet_address)) as bigint;
  });
  return {
    balanceRaw: balance.toString(),
    balance: formatTokenAmount(balance, decimals),
    walletAddress: wallet.wallet_address
  };
}

export async function sendTokenTransfer(
  fromWalletId: string,
  toAddress: string,
  tokenAddress: string,
  amount: string | number,
  decimals: number,
  type: "payroll" | "loan_disbursement" | "investment" | "treasury_allocation" | "emi_repayment" | "withdrawal",
  tokenSymbol: string,
  recipientWalletId?: string | null
) {
  const wallet = await getWalletRecord(fromWalletId);
  const chain = requireSupportedEvmChain(wallet.chain, "token");
  const amountRaw = parseTokenAmount(amount, decimals);
  const maxTx = parseFloat(env.MAX_TX_AMOUNT);
  if (parseFloat(amount.toString()) > maxTx) {
    throw new ApiError(400, `Transfer exceeds max transaction limit (${maxTx})`);
  }

  let seedPhrase = "";
  try {
    seedPhrase = decryptSecret(wallet.encrypted_seed);
  } catch (error) {
    const mapped = mapWalletDecryptError(error);
    if (mapped) {
      throw mapped;
    }
    throw error;
  }

  const wdk = buildWdk(seedPhrase);
  let account: WalletAccountEvm;
  try {
    account = (await wdk.getAccount(chain, 0)) as unknown as WalletAccountEvm;
  } catch (error) {
    const mapped = mapWalletDecryptError(error);
    if (mapped) {
      throw mapped;
    }
    throw error;
  }
  try {
    const balanceRaw = await account.getTokenBalance(tokenAddress);
    if (balanceRaw < amountRaw) {
      throw new ApiError(400, "Insufficient wallet balance");
    }

    const nativeBalance = await account.getBalance();
    const requiredNativeGas = minimumNativeGasReserveWei + transferMaxFee;
    if (nativeBalance < requiredNativeGas) {
      throw new ApiError(
        400,
        `Insufficient ETH for gas. Keep at least ${formatAmount(minimumNativeGasReserveWei)} ETH reserved, plus network fee headroom.`
      );
    }

    const txResult = await account.transfer({
      token: tokenAddress,
      recipient: toAddress,
      amount: amountRaw
    });

    const createdAt = new Date();
    await insertTransactionRecord({
      walletId: wallet.id,
      type,
      amount: amount.toString(),
      txHash: txResult?.hash ?? null,
      tokenSymbol,
      createdAt
    });
    await mirrorEmployeeLedgerEntry({
      recipientWalletId,
      type,
      amount: amount.toString(),
      txHash: txResult?.hash ?? null,
      tokenSymbol,
      createdAt
    });

    return {
      txHash: txResult?.hash ?? null,
      amount: amount.toString(),
      from: await account.getAddress(),
      to: toAddress
    };
  } finally {
    seedPhrase = "";
    account.dispose();
  }
}

export async function sendTransaction(
  fromWalletId: string,
  toAddress: string,
  amountEth: string | number,
  type: "payroll" | "loan_disbursement" | "investment" | "treasury_allocation" | "emi_repayment" | "withdrawal",
  recipientWalletId?: string | null
) {
  if (env.TREASURY_TOKEN_ADDRESS && env.TREASURY_TOKEN_SYMBOL) {
    const decimals = parseInt(env.TREASURY_TOKEN_DECIMALS, 10);
    return sendTokenTransfer(
      fromWalletId,
      toAddress,
      env.TREASURY_TOKEN_ADDRESS,
      amountEth,
      decimals,
      type,
      env.TREASURY_TOKEN_SYMBOL,
      recipientWalletId
    );
  }

  const wallet = await getWalletRecord(fromWalletId);
  const chain = requireSupportedEvmChain(wallet.chain, "native");
  const amountWei = parseAmount(amountEth);
  const maxTx = parseFloat(env.MAX_TX_AMOUNT);
  if (parseFloat(amountEth.toString()) > maxTx) {
    throw new ApiError(400, `Transfer exceeds max transaction limit (${maxTx})`);
  }

  let seedPhrase = "";
  try {
    seedPhrase = decryptSecret(wallet.encrypted_seed);
  } catch (error) {
    const mapped = mapWalletDecryptError(error);
    if (mapped) {
      throw mapped;
    }
    throw error;
  }

  const wdk = buildWdk(seedPhrase);
  let account: WalletAccountEvm;
  try {
    account = (await wdk.getAccount(chain, 0)) as unknown as WalletAccountEvm;
  } catch (error) {
    const mapped = mapWalletDecryptError(error);
    if (mapped) {
      throw mapped;
    }
    throw error;
  }
  try {
    const balanceWei = await account.getBalance();
    if (balanceWei < amountWei + transferMaxFee) {
      throw new ApiError(400, "Insufficient wallet balance to cover transfer amount and network fee");
    }

    const txResult = await account.sendTransaction({
      to: toAddress,
      value: amountWei
    });

    const createdAt = new Date();
    await insertTransactionRecord({
      walletId: wallet.id,
      type,
      amount: amountEth.toString(),
      txHash: txResult?.hash ?? null,
      tokenSymbol: "ETH",
      createdAt
    });
    await mirrorEmployeeLedgerEntry({
      recipientWalletId,
      type,
      amount: amountEth.toString(),
      txHash: txResult?.hash ?? null,
      tokenSymbol: "ETH",
      createdAt
    });

    return {
      txHash: txResult?.hash ?? null,
      amountEth: amountEth.toString(),
      from: await account.getAddress(),
      to: toAddress
    };
  } finally {
    seedPhrase = "";
    account.dispose();
  }
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
  await startDepositWatcher(row.wallet_id, row.company_id, row.wallet_address, { force: true });
  return { status: "listening" };
}
