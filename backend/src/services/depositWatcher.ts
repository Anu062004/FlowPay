import { JsonRpcProvider, formatEther } from "ethers";
import { env } from "../config/env.js";
import { db } from "../db/pool.js";
import { allocateTreasury } from "./treasuryService.js";

const rpcUrl = env.RPC_URL.replace("{WDK_API_KEY}", env.WDK_API_KEY);
const provider = new JsonRpcProvider(rpcUrl);
const pollIntervalMs = 30000;

const watchers = new Map<
  string,
  {
    address: string;
    companyId: string;
    lastBalance: bigint;
    lastBlock: number;
    timer: NodeJS.Timeout;
  }
>();

async function pollWallet(walletId: string) {
  const watcher = watchers.get(walletId);
  if (!watcher) return;
  const currentBlock = await provider.getBlockNumber();
  if (currentBlock <= watcher.lastBlock) return;

  const addressLower = watcher.address.toLowerCase();
  let sawDeposit = false;

  for (let blockNumber = watcher.lastBlock + 1; blockNumber <= currentBlock; blockNumber += 1) {
    const block = await provider.getBlock(blockNumber, true);
    const transactions = block?.transactions ?? [];
    for (const tx of transactions) {
      if (!tx?.to) continue;
      if (tx.to.toLowerCase() !== addressLower) continue;
      if (!tx.value || tx.value === 0n) continue;

      const exists = await db.query(
        "SELECT 1 FROM transactions WHERE tx_hash = $1 LIMIT 1",
        [tx.hash]
      );
      if (exists.rowCount > 0) continue;

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

      if (updateResult.rowCount === 0) {
        await db.query(
          "INSERT INTO transactions (wallet_id, type, amount, tx_hash) VALUES ($1, 'deposit', $2, $3)",
          [walletId, amountEth, tx.hash]
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
  const balance = await provider.getBalance(address);
  const currentBlock = await provider.getBlockNumber();
  const lastBlock = Math.max(currentBlock - 120, 0);
  const timer = setInterval(() => {
    pollWallet(walletId).catch((error) => {
      console.error("Deposit watcher error", { walletId, error });
    });
  }, pollIntervalMs);

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
