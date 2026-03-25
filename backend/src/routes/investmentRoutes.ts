import { Router } from "express";
import { asyncHandler } from "../utils/errors.js";
import { db } from "../db/pool.js";
import { uuidQueryParam } from "../utils/validation.js";
import { getTradingAgentsOverview, runInvestment } from "../services/investmentService.js";
import { getEthPrice, getTrackedMarketBoard } from "../services/priceService.js";
import { z } from "zod";
import { assertCompanyScope, requireCompanySession } from "../middleware/auth.js";
import { getCompanySettlementChain } from "../services/companySettlementService.js";
import { getExecutionTokenSymbolForChain } from "../services/investmentNetworkConfig.js";

const router = Router();

// ── GET /investments?companyId= ───────────────────────────────
// Summary + transaction history for the company's investment activity
router.get(
  "/",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    assertCompanyScope(res, companyId);
    const settlementChain = await getCompanySettlementChain(companyId);

    // Latest treasury allocation (investment pool config)
    const allocResult = await db.query(
      `SELECT investment_pool, payroll_reserve, lending_pool, main_reserve, created_at
       FROM treasury_allocations
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [companyId]
    );

    const allocation = allocResult.rows[0] ?? null;

    const positionsResult = await db.query(
      `SELECT
         id,
         protocol,
         amount_deposited,
         atoken_balance,
         yield_earned,
         status,
         opened_at,
         closed_at,
         tx_hash,
         entry_price
       FROM investment_positions
       WHERE company_id = $1
       ORDER BY opened_at DESC
       LIMIT 50`,
      [companyId]
    );

    // All investment transactions for this company's treasury wallet
    const txResult = await db.query(
      `SELECT
         t.id,
         t.amount,
         t.token_symbol,
         t.tx_hash,
         t.created_at
       FROM transactions t
       JOIN wallets w ON t.wallet_id = w.id
       WHERE t.type = 'investment'
         AND w.id = (
           SELECT treasury_wallet_id FROM companies WHERE id = $1
         )
       ORDER BY t.created_at DESC
       LIMIT 50`,
      [companyId]
    );

    const totalInvested = txResult.rows.reduce(
      (s: number, r: { amount: string }) => s + parseFloat(r.amount),
      0
    );

    let market: { asset: string; price: number; change_pct: number; source: string } | null = null;
    let marketBoard: Awaited<ReturnType<typeof getTrackedMarketBoard>> | null = null;
    try {
      const executionTokenSymbol = getExecutionTokenSymbolForChain(settlementChain);
      if (executionTokenSymbol === "USDT" || executionTokenSymbol === "USDC") {
        market = {
          asset: executionTokenSymbol,
          price: 1,
          change_pct: 0,
          source: "stable-peg"
        };
      } else {
        const price = await getEthPrice();
        market = {
          asset: "ETH",
          price: price.price,
          change_pct: price.changePct,
          source: price.source
        };
      }
    } catch {
      market = null;
    }

    try {
      marketBoard = await getTrackedMarketBoard(20);
    } catch {
      marketBoard = null;
    }

    const tradingAgents = await getTradingAgentsOverview(companyId);

    res.status(200).json({
      allocation,
      positions: positionsResult.rows,
      transactions: txResult.rows,
      summary: {
        total_invested: totalInvested.toFixed(6),
        investment_pool: allocation?.investment_pool ?? "0",
        transaction_count: txResult.rows.length,
      },
      execution_token_symbol: getExecutionTokenSymbolForChain(settlementChain),
      settlement_chain: settlementChain,
      market,
      marketBoard,
      trading_agents: tradingAgents
    });
  })
);

// ── POST /investments/run ─────────────────────────────────────
router.post(
  "/run",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const companyId = z.string().uuid().parse(req.body?.companyId);
    assertCompanyScope(res, companyId);
    const result = await runInvestment(companyId);
    res.status(200).json(result);
  })
);

export default router;
