import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/errors.js";
import { db } from "../db/pool.js";
import { uuidQueryParam } from "../utils/validation.js";
import { getTokenTransfers } from "../services/indexerService.js";
import { assertCompanyScope, assertEmployeeScope, requireCompanySession, requireEmployeeSession } from "../middleware/auth.js";
import { getCompanySettlementChain } from "../services/companySettlementService.js";
import { getSettlementTokenConfig } from "../utils/settlement.js";

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
         COALESCE(
           t.tx_hash,
           CASE
             WHEN t.type = 'emi_repayment' THEN (
               SELECT pd.tx_hash
               FROM payroll_disbursements pd
               JOIN companies c2 ON c2.id = pd.company_id
               WHERE c2.treasury_wallet_id = t.wallet_id
                 AND pd.tx_hash IS NOT NULL
                 AND pd.emi_deducted = t.amount
                 AND pd.payroll_month = date_trunc('month', t.created_at AT TIME ZONE 'UTC')::date
               ORDER BY ABS(EXTRACT(EPOCH FROM (pd.created_at - t.created_at))) ASC, pd.created_at DESC
               LIMIT 1
             )
             ELSE NULL
           END
         ) AS tx_hash,
         t.token_symbol,
         t.chain,
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
    const companyChain = await getCompanySettlementChain(companyId);
    const companyToken = getSettlementTokenConfig(companyChain);
    const token = (req.query.token as string | undefined) ?? companyToken?.symbol.toLowerCase() ?? "usdt";
    const blockchain = (req.query.blockchain as string | undefined) ?? companyToken?.blockchain ?? companyChain;
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
         COALESCE(
           t.tx_hash,
           CASE
             WHEN t.type = 'emi_repayment' THEN (
               SELECT pd.tx_hash
               FROM payroll_disbursements pd
               JOIN employees e2 ON e2.id = pd.employee_id
               WHERE e2.wallet_id = t.wallet_id
                 AND pd.tx_hash IS NOT NULL
                 AND pd.emi_deducted = t.amount
                 AND pd.payroll_month = date_trunc('month', t.created_at AT TIME ZONE 'UTC')::date
               ORDER BY ABS(EXTRACT(EPOCH FROM (pd.created_at - t.created_at))) ASC, pd.created_at DESC
               LIMIT 1
             )
             ELSE NULL
           END
         ) AS tx_hash,
         t.token_symbol,
         t.chain,
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
