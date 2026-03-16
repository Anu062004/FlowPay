import { db } from "../db/pool.js";
import { getEthPrice } from "./priceService.js";
import { runInvestmentAgent } from "../agents/investmentAgent.js";
import { sendTransaction } from "./walletService.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/errors.js";

export async function runInvestment(companyId: string) {
  const treasuryResult = await db.query(
    "SELECT w.id as wallet_id FROM companies c JOIN wallets w ON c.treasury_wallet_id = w.id WHERE c.id = $1",
    [companyId]
  );
  if (treasuryResult.rowCount === 0) {
    throw new ApiError(404, "Treasury wallet not found");
  }
  const treasuryWalletId = treasuryResult.rows[0].wallet_id;

  const allocationResult = await db.query(
    "SELECT investment_pool FROM treasury_allocations WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1",
    [companyId]
  );

  const investmentPool = allocationResult.rowCount
    ? parseFloat(allocationResult.rows[0].investment_pool)
    : 0;

  if (investmentPool <= 0) {
    return { decision: "hold", reason: "No investment pool allocated" };
  }

  const priceInfo = await getEthPrice();
  const decision = await runInvestmentAgent({
    balance: investmentPool,
    investment_pool: investmentPool,
    eth_price: priceInfo.price,
    price_change_pct: priceInfo.changePct
  }).catch(() => ({
    decision: "hold" as const,
    allocation_pct: 0,
    rationale: "Agent unavailable"
  }));

  if (decision.decision === "hold" || decision.allocation_pct <= 0) {
    return decision;
  }

  const investAmount = investmentPool * decision.allocation_pct;

  if (env.INVESTMENT_WALLET_ADDRESS) {
    await sendTransaction(treasuryWalletId, env.INVESTMENT_WALLET_ADDRESS, investAmount, "investment");
  } else {
    await db.query(
      "INSERT INTO transactions (wallet_id, type, amount) VALUES ($1, 'investment', $2)",
      [treasuryWalletId, investAmount.toFixed(6)]
    );
  }

  return { ...decision, invested_amount: investAmount };
}
