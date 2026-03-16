import { Router } from "express";
import { asyncHandler } from "../utils/errors.js";
import { db } from "../db/pool.js";
import { uuidQueryParam } from "../utils/validation.js";
import { runInvestment } from "../services/investmentService.js";
import { getEthPrice, getTopMarketCap } from "../services/priceService.js";
import { z } from "zod";

const router = Router();

// ── GET /investments?companyId= ───────────────────────────────
// Summary + transaction history for the company's investment activity
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);

    // Latest treasury allocation (investment pool config)
    const allocResult = await db.query(
      `SELECT investment_pool, payroll_reserve, lending_pool, created_at
       FROM treasury_allocations
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [companyId]
    );

    const allocation = allocResult.rows[0] ?? null;

    // All investment transactions for this company's treasury wallet
    const txResult = await db.query(
      `SELECT
         t.id,
         t.amount,
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
    let marketTop: ReturnType<typeof getTopMarketCap> extends Promise<infer T> ? T : never = [];
    try {
      const price = await getEthPrice();
      market = {
        asset: "ETH",
        price: price.price,
        change_pct: price.changePct,
        source: price.source
      };
    } catch {
      market = null;
    }

    try {
      marketTop = await getTopMarketCap(10);
    } catch {
      marketTop = [];
    }

    res.status(200).json({
      allocation,
      transactions: txResult.rows,
      summary: {
        total_invested: totalInvested.toFixed(6),
        investment_pool: allocation?.investment_pool ?? "0",
        transaction_count: txResult.rows.length,
      },
      market,
      marketTop
    });
  })
);

// ── POST /investments/run ─────────────────────────────────────
router.post(
  "/run",
  asyncHandler(async (req, res) => {
    const companyId = z.string().uuid().parse(req.body?.companyId);
    const result = await runInvestment(companyId);
    res.status(200).json(result);
  })
);

export default router;
