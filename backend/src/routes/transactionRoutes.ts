import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/errors.js";
import { db } from "../db/pool.js";
import { uuidQueryParam } from "../utils/validation.js";

const router = Router();

// ── GET /transactions?companyId= ─────────────────────────────
// Full treasury ledger for a company (all tx types)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    const limit = Math.min(parseInt((req.query.limit as string) ?? "50"), 100);
    const offset = parseInt((req.query.offset as string) ?? "0");

    const result = await db.query(
      `SELECT
         t.id,
         t.type,
         t.amount,
         t.tx_hash,
         t.created_at,
         w.wallet_address
       FROM transactions t
       JOIN wallets w ON t.wallet_id = w.id
       WHERE w.id = (
           SELECT treasury_wallet_id FROM companies WHERE id = $1
         )
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [companyId, limit, offset]
    );

    const countResult = await db.query(
      `SELECT COUNT(*) FROM transactions t
       JOIN wallets w ON t.wallet_id = w.id
       WHERE w.id = (
           SELECT treasury_wallet_id FROM companies WHERE id = $1
         )`,
      [companyId]
    );

    res.status(200).json({
      transactions: result.rows,
      total: parseInt(countResult.rows[0].count),
    });
  })
);

// ── GET /transactions/me/:employeeId ─────────────────────────
// Personal transaction history for an employee's wallet
router.get(
  "/me/:employeeId",
  asyncHandler(async (req, res) => {
    const employeeId = z.string().uuid().parse(req.params.employeeId);
    const result = await db.query(
      `SELECT
         t.id,
         t.type,
         t.amount,
         t.tx_hash,
         t.created_at
       FROM transactions t
       JOIN wallets w ON t.wallet_id = w.id
       WHERE w.owner_type = 'employee' AND w.owner_id = $1
       ORDER BY t.created_at DESC
       LIMIT 50`,
      [employeeId]
    );
    res.status(200).json({ transactions: result.rows });
  })
);

export default router;
