import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/errors.js";
import { db } from "../db/pool.js";
import { uuidQueryParam } from "../utils/validation.js";
import { env } from "../config/env.js";
import { getTokenTransfers } from "../services/indexerService.js";
import { assertCompanyScope, assertEmployeeScope, requireCompanySession, requireEmployeeSession } from "../middleware/auth.js";

const router = Router();

// ── GET /transactions?companyId= ─────────────────────────────
// Full treasury ledger for a company (all tx types)
router.get(
  "/",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    assertCompanyScope(res, companyId);
    const limit = Math.min(parseInt((req.query.limit as string) ?? "50"), 100);
    const offset = parseInt((req.query.offset as string) ?? "0");

    const result = await db.query(
      `SELECT
         t.id,
         t.type,
         t.amount,
         t.tx_hash,
         t.token_symbol,
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

// â”€â”€ GET /transactions/onchain?companyId=&token=&blockchain= â”€â”€â”€â”€â”€
// Raw on-chain token transfers from WDK Indexer
router.get(
  "/onchain",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    assertCompanyScope(res, companyId);
    const token = (req.query.token as string | undefined) ?? env.TREASURY_TOKEN_SYMBOL ?? "usdt";
    const blockchain = (req.query.blockchain as string | undefined) ?? env.TREASURY_TOKEN_BLOCKCHAIN;
    const limit = Math.min(parseInt((req.query.limit as string) ?? "50"), 200);

    const walletResult = await db.query(
      `SELECT w.wallet_address
       FROM companies c
       JOIN wallets w ON c.treasury_wallet_id = w.id
       WHERE c.id = $1`,
      [companyId]
    );
    if (walletResult.rowCount === 0) {
      return res.status(404).json({ error: "Treasury wallet not found" });
    }
    const address = walletResult.rows[0].wallet_address;
    const data = await getTokenTransfers({ blockchain, token, address, limit });
    res.status(200).json({ address, token, blockchain, ...data });
  })
);

// ── GET /transactions/me/:employeeId ─────────────────────────
// Personal transaction history for an employee's wallet
router.get(
  "/me/:employeeId",
  requireEmployeeSession,
  asyncHandler(async (req, res) => {
    const employeeId = z.string().uuid().parse(req.params.employeeId);
    assertEmployeeScope(res, employeeId);
    const result = await db.query(
      `SELECT
         t.id,
         t.type,
         t.amount,
         t.tx_hash,
         t.token_symbol,
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
