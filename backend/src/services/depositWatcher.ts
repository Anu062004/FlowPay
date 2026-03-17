import { JsonRpcProvider, formatEther } from "ethers";
import { env } from "../config/env.js";
import { db } from "../db/pool.js";
import { allocateTreasury } from "./treasuryService.js";
import { getTokenBalance, getTokenTransfers } from "./indexerService.js";
import { formatTokenAmount } from "../utils/amounts.js";

const rpcUrl = env.RPC_URL.replace("{WDK_API_KEY}", env.WDK_API_KEY);
const provider = new JsonRpcProvider(rpcUrl);
const pollIntervalMs = 30000;
const useTokenIndexer = Boolean(env.TREASURY_TOKEN_ADDRESS && env.TREASURY_TOKEN_SYMBOL);

type Watcher = {
  address: string;
  companyId: string;
  lastBalance?: bigint;
  lastBlock?: number;
  lastSeenAt?: number;
  timer: NodeJS.Timeout;
};

const watchers = new Map<string, Watcher>();

function normalizeTransfers(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.tokenTransfers)) return data.tokenTransfers;
  if (Array.isArray(data.transfers)) return data.transfers;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num < 1e12 ? num * 1000 : num;
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

function extractTimestamp(transfer: any): number | null {
  const keys = ["timestamp", "blockTimestamp", "block_time", "time", "blockTime", "createdAt", "created_at"];
  for (const key of keys) {
    const ts = parseTimestamp(transfer?.[key]);
    if (ts) return ts;
  }
  return null;
}

function extractRecipient(transfer: any): string | null {
  return (
    transfer?.to ??
    transfer?.toAddress ??
    transfer?.recipient ??
    transfer?.to_account ??
    transfer?.toAccount ??
    null
  );
}

function extractHash(transfer: any): string | null {
  return (
    transfer?.txHash ??
    transfer?.transactionHash ??
    transfer?.hash ??
    transfer?.txid ??
    transfer?.tx_id ??
    null
  );
}

function extractAmountRaw(transfer: any): string | null {
  const raw = transfer?.amount ?? transfer?.value ?? transfer?.quantity ?? transfer?.rawAmount ?? null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "bigint") return raw.toString();
  if (typeof raw === "number" || typeof raw === "string") return String(raw);
  return null;
}

async function pollWallet(walletId: string) {
  const watcher = watchers.get(walletId);
  if (!watcher) return;

  if (useTokenIndexer) {
    const token = env.TREASURY_TOKEN_SYMBOL!.toLowerCase();
    const blockchain = env.TREASURY_TOKEN_BLOCKCHAIN;
    const transfersData = await getTokenTransfers({
      blockchain,
      token,
      address: watcher.address,
      limit: 200
    });
    const transfers = normalizeTransfers(transfersData);
    const addressLower = watcher.address.toLowerCase();
    let sawDeposit = false;
    let newestSeen = watcher.lastSeenAt ?? 0;
    const decimals = parseInt(env.TREASURY_TOKEN_DECIMALS, 10);

    for (const transfer of transfers) {
      const recipient = extractRecipient(transfer)?.toLowerCase();
      if (!recipient || recipient !== addressLower) continue;
      const ts = extractTimestamp(transfer) ?? 0;
      if (watcher.lastSeenAt && ts <= watcher.lastSeenAt) continue;

      const amountRawStr = extractAmountRaw(transfer);
      if (!amountRawStr) continue;
      const amountRaw = BigInt(amountRawStr);
      const amountFormatted = formatTokenAmount(amountRaw, decimals);
      const txHash = extractHash(transfer);

      if (txHash) {
        const exists = await db.query(
          "SELECT 1 FROM transactions WHERE tx_hash = $1 LIMIT 1",
          [txHash]
        );
        if ((exists.rowCount ?? 0) > 0) {
          newestSeen = Math.max(newestSeen, ts);
          continue;
        }
      }

      const updateResult = await db.query(
        `WITH target AS (
           SELECT id FROM transactions
           WHERE wallet_id = $1
             AND type = 'deposit'
             AND tx_hash IS NULL
             AND amount = $2
           ORDER BY created_at DESC
           LIMIT 1
         )
         UPDATE transactions SET tx_hash = $3
         WHERE id IN (SELECT id FROM target)
         RETURNING id`,
        [walletId, amountFormatted, txHash]
      );

      if ((updateResult.rowCount ?? 0) === 0) {
        await db.query(
          "INSERT INTO transactions (wallet_id, type, amount, tx_hash, token_symbol) VALUES ($1, 'deposit', $2, $3, $4)",
          [walletId, amountFormatted, txHash, env.TREASURY_TOKEN_SYMBOL]
        );
      }

      sawDeposit = true;
      newestSeen = Math.max(newestSeen, ts);
    }

    watcher.lastSeenAt = newestSeen || watcher.lastSeenAt;

    if (sawDeposit) {
      const balanceData = await getTokenBalance({
        blockchain,
        token,
        address: watcher.address
      });
      const balanceRaw = BigInt(
        balanceData?.amount ??
          balanceData?.balance ??
          balanceData?.tokenBalance?.amount ??
          "0"
      );
      await allocateTreasury(watcher.companyId, balanceRaw);
    }
    return;
  }

  const currentBlock = await provider.getBlockNumber();
  if (watcher.lastBlock !== undefined && currentBlock <= watcher.lastBlock) return;

  const addressLower = watcher.address.toLowerCase();
  let sawDeposit = false;
  const startBlock = watcher.lastBlock ?? Math.max(currentBlock - 120, 0);

  for (let blockNumber = startBlock + 1; blockNumber <= currentBlock; blockNumber += 1) {
    const block = (await provider.getBlock(blockNumber, true)) as any;
    const transactions = (block?.transactions ?? []) as any[];
    for (const tx of transactions) {
      if (!tx?.to) continue;
      if (tx.to.toLowerCase() !== addressLower) continue;
      if (!tx.value || tx.value === 0n) continue;

      const exists = await db.query(
        "SELECT 1 FROM transactions WHERE tx_hash = $1 LIMIT 1",
        [tx.hash]
      );
      if ((exists.rowCount ?? 0) > 0) continue;

      const amountEth = formatEther(tx.value);
      const updateResult = await db.query(
        `WITH target AS (
           SELECT id FROM transactions
           WHERE wallet_id = $1
             AND type = 'deposit'
             AND tx_hash IS NULL
             AND amount = $2
           ORDER BY created_at DESC
           LIMIT 1
         )
         UPDATE transactions SET tx_hash = $3
         WHERE id IN (SELECT id FROM target)
         RETURNING id`,
        [walletId, amountEth, tx.hash]
      );

      if ((updateResult.rowCount ?? 0) === 0) {
        await db.query(
          "INSERT INTO transactions (wallet_id, type, amount, tx_hash, token_symbol) VALUES ($1, 'deposit', $2, $3, $4)",
          [walletId, amountEth, tx.hash, "ETH"]
        );
      }
      sawDeposit = true;
    }
  }

  watcher.lastBlock = currentBlock;

  if (sawDeposit) {
    const balance = await provider.getBalance(watcher.address);
    await allocateTreasury(watcher.companyId, balance);
    watcher.lastBalance = balance;
  }
}

export async function startDepositWatcher(walletId: string, companyId: string, address: string) {
  if (watchers.has(walletId)) return;
  const timer = setInterval(() => {
    pollWallet(walletId).catch((error) => {
      console.error("Deposit watcher error", { walletId, error });
    });
  }, pollIntervalMs);

  if (useTokenIndexer) {
    let lastSeenAt = Date.now();
    try {
      const token = env.TREASURY_TOKEN_SYMBOL!.toLowerCase();
      const blockchain = env.TREASURY_TOKEN_BLOCKCHAIN;
      const transfersData = await getTokenTransfers({
        blockchain,
        token,
        address,
        limit: 1
      });
      const transfers = normalizeTransfers(transfersData);
      const ts = transfers.length ? extractTimestamp(transfers[0]) : null;
      if (ts) lastSeenAt = ts;
    } catch (error) {
      console.error("Failed to initialize indexer watcher", { walletId, error });
    }

    watchers.set(walletId, {
      address,
      companyId,
      lastSeenAt,
      timer
    });
    return;
  }

  const balance = await provider.getBalance(address);
  const currentBlock = await provider.getBlockNumber();
  const lastBlock = Math.max(currentBlock - 120, 0);

  watchers.set(walletId, {
    address,
    companyId,
    lastBalance: balance,
    lastBlock,
    timer
  });
}

export async function startAllTreasuryWatchers() {
  const result = await db.query(
    "SELECT c.id as company_id, w.id as wallet_id, w.wallet_address FROM companies c JOIN wallets w ON c.treasury_wallet_id = w.id"
  );
  for (const row of result.rows) {
    await startDepositWatcher(row.wallet_id, row.company_id, row.wallet_address);
  }
}

export async function stopDepositWatcher(walletId: string) {
  const watcher = watchers.get(walletId);
  if (!watcher) return;
  clearInterval(watcher.timer);
  watchers.delete(walletId);
}
