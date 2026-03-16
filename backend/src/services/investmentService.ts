import { db } from "../db/pool.js";
import { getEthPrice } from "./priceService.js";
import { runInvestmentAgent } from "../agents/investmentAgent.js";
import { env } from "../config/env.js";
import { depositToAave, getATokenBalance, getYieldEarned, withdrawFromAave } from "./aaveService.js";
import { logAgentAction } from "./agentLogService.js";

function toFixedNum(value: number): number {
  return parseFloat(value.toFixed(6));
}

export async function runInvestment(companyId: string) {
  const allocationResult = await db.query(
    "SELECT investment_pool, payroll_reserve, lending_pool FROM treasury_allocations WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1",
    [companyId]
  );

  const investmentPool = allocationResult.rowCount
    ? parseFloat(allocationResult.rows[0].investment_pool)
    : 0;

  const atokenBalance = await getATokenBalance(companyId);
  const yieldEarned = await getYieldEarned(companyId);
  const activePositionsResult = await db.query(
    "SELECT COUNT(*) AS count FROM investment_positions WHERE company_id = $1 AND status = 'active'",
    [companyId]
  );
  const openPositions = parseInt(activePositionsResult.rows[0].count, 10);
  const priceInfo = await getEthPrice();

  const agentInput = {
    balance: investmentPool,
    investment_pool: investmentPool,
    eth_price: priceInfo.price,
    price_change_pct: priceInfo.changePct,
    atoken_balance: atokenBalance,
    yield_earned: yieldEarned,
    open_positions: openPositions
  };

  const decision = await runInvestmentAgent(agentInput);

  if (decision.decision === "invest" && decision.allocation_pct > 0) {
    const investAmount = investmentPool * decision.allocation_pct;
    const payrollReserve = parseFloat(allocationResult.rows[0]?.payroll_reserve ?? "0");
    const lendingPool = parseFloat(allocationResult.rows[0]?.lending_pool ?? "0");
    const totalTreasury = investmentPool + payrollReserve + lendingPool;
    const maxExposure = totalTreasury * parseFloat(env.MAX_AAVE_EXPOSURE_PCT);
    if (atokenBalance + investAmount > maxExposure) {
      await logAgentAction(
        "InvestmentAgent",
        agentInput,
        decision,
        "Blocked by exposure cap",
        `Skipped invest. Exposure cap ${maxExposure.toFixed(6)} ETH would be exceeded.`,
        companyId
      );
      return { ...decision, invested_amount: 0, txHash: null };
    }

    const txHash = await depositToAave(companyId, investAmount);
    const updatedATokenBalance = await getATokenBalance(companyId);
    const updatedYieldEarned = await getYieldEarned(companyId);

    await db.query(
      `INSERT INTO investment_positions
       (company_id, amount_deposited, atoken_balance, yield_earned, entry_price, tx_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
      [
        companyId,
        toFixedNum(investAmount),
        toFixedNum(updatedATokenBalance),
        toFixedNum(updatedYieldEarned),
        toFixedNum(priceInfo.price),
        txHash
      ]
    );

    await logAgentAction(
      "InvestmentAgent",
      agentInput,
      decision,
      decision.rationale,
      `Invested ${investAmount.toFixed(6)} ETH into Aave V3. Tx: ${txHash}`,
      companyId
    );

    return { ...decision, invested_amount: investAmount, txHash };
  }

  const activePositionsDetail = await db.query(
    "SELECT id, amount_deposited, entry_price FROM investment_positions WHERE company_id = $1 AND status = 'active' ORDER BY opened_at ASC",
    [companyId]
  );

  if (decision.decision === "withdraw" && activePositionsDetail.rowCount > 0) {
    for (const pos of activePositionsDetail.rows) {
      const withdrawAmount = parseFloat(pos.amount_deposited);
      try {
        const txHash = await withdrawFromAave(companyId, withdrawAmount);
        await db.query(
          "UPDATE investment_positions SET status = 'closed', closed_at = now() WHERE id = $1",
          [pos.id]
        );
        await logAgentAction(
          "InvestmentAgent",
          agentInput,
          decision,
          decision.rationale,
          `Withdrew ${withdrawAmount.toFixed(6)} ETH from Aave on withdraw decision. Tx: ${txHash}`,
          companyId
        );
      } catch (error) {
        await db.query("UPDATE investment_positions SET status = 'sync_failed' WHERE id = $1", [pos.id]);
        const errorMessage = error instanceof Error ? error.message : "Unknown withdrawal error";
        await logAgentAction(
          "InvestmentAgent",
          agentInput,
          decision,
          errorMessage,
          `WITHDRAWAL_FAILED for ${withdrawAmount.toFixed(6)} ETH on position ${pos.id}`,
          companyId
        );
      }
    }
  }

  if (decision.decision === "hold" && activePositionsDetail.rowCount > 0) {
    for (const pos of activePositionsDetail.rows) {
      const entryPrice = parseFloat(pos.entry_price);
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
        continue;
      }
      const priceDropPct = ((entryPrice - priceInfo.price) / entryPrice) * 100;
      if (priceDropPct <= 15) {
        continue;
      }

      const withdrawAmount = parseFloat(pos.amount_deposited);
      try {
        const txHash = await withdrawFromAave(companyId, withdrawAmount);
        await db.query(
          "UPDATE investment_positions SET status = 'closed', closed_at = now() WHERE id = $1",
          [pos.id]
        );
        await logAgentAction(
          "InvestmentAgent",
          agentInput,
          decision,
          decision.rationale,
          `Hold-mode stop loss triggered (${priceDropPct.toFixed(2)}% drop). Withdrew ${withdrawAmount.toFixed(6)} ETH. Tx: ${txHash}`,
          companyId
        );
      } catch (error) {
        await db.query("UPDATE investment_positions SET status = 'sync_failed' WHERE id = $1", [pos.id]);
        const errorMessage = error instanceof Error ? error.message : "Unknown withdrawal error";
        await logAgentAction(
          "InvestmentAgent",
          agentInput,
          decision,
          errorMessage,
          `WITHDRAWAL_FAILED during hold stop-loss for ${withdrawAmount.toFixed(6)} ETH on position ${pos.id}`,
          companyId
        );
      }
    }
  }

  return decision;
}
