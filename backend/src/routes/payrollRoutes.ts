import { Router } from "express";
import { z } from "zod";
import { requestPayrollApproval, runPayroll } from "../services/payrollService.js";
import { asyncHandler } from "../utils/errors.js";
import { db } from "../db/pool.js";
import { uuidQueryParam } from "../utils/validation.js";
import { assertCompanyScope, getCompanySession, requireCompanySession } from "../middleware/auth.js";

const router = Router();

const runSchema = z.object({
  companyId: z.string().uuid().optional(),
  requireApproval: z.boolean().optional()
});

// ── GET /payroll/history?companyId= ──────────────────────────
// Past payroll disbursements drawn from the transactions table
router.get(
  "/history",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    assertCompanyScope(res, companyId);
    const result = await db.query(
      `SELECT
         t.id,
         t.amount,
         t.created_at,
         t.tx_hash,
         COUNT(e.id) AS employee_count
       FROM transactions t
       JOIN wallets w ON t.wallet_id = w.id
       JOIN companies c ON c.treasury_wallet_id = w.id
       LEFT JOIN employees e ON e.company_id = c.id AND e.status = 'active'
       WHERE c.id = $1 AND t.type = 'payroll'
       GROUP BY t.id
       ORDER BY t.created_at DESC
       LIMIT 24`,
      [companyId]
    );
    res.status(200).json({ history: result.rows });
  })
);

// ── POST /payroll/run ─────────────────────────────────────────
router.post(
  "/run",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const payload = runSchema.parse(req.body ?? {});
    const session = getCompanySession(res);
    const companyId = payload.companyId ?? session!.companyId;
    assertCompanyScope(res, companyId);
    const result = payload.requireApproval
      ? await requestPayrollApproval(companyId)
      : await runPayroll(companyId);
    res.status(200).json(result);
  })
);

export default router;
