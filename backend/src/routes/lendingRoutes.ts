import { Router } from "express";
import { z } from "zod";
import { getLendingHistory } from "../services/lendingService.js";
import { asyncHandler } from "../utils/errors.js";
import { uuidQueryParam } from "../utils/validation.js";
import { db } from "../db/pool.js";
import { assertCompanyScope, assertEmployeeScope, requireCompanySession, requireEmployeeSession } from "../middleware/auth.js";

const router = Router();

// ── GET /lending/history?companyId= ──────────────────────────
// Employer view: all loans for a company + summary
router.get(
  "/history",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    assertCompanyScope(res, companyId);
    const result = await getLendingHistory(companyId);
    res.status(200).json(result);
  })
);

// ── GET /lending/me/:employeeId ───────────────────────────────
// Employee portal: their own loans with installment schedule
router.get(
  "/me/:employeeId",
  requireEmployeeSession,
  asyncHandler(async (req, res) => {
    const employeeId = z.string().uuid().parse(req.params.employeeId);
    assertEmployeeScope(res, employeeId);

    const loans = await db.query(
      `SELECT
         l.id,
         l.amount,
         l.interest_rate,
         l.duration_months,
         l.remaining_balance,
         l.status,
         l.created_at,
         l.updated_at
       FROM loans l
       WHERE l.employee_id = $1
       ORDER BY l.created_at DESC`,
      [employeeId]
    );

    // Compute months paid for each active loan
    const enriched = loans.rows.map((loan) => {
      const monthlyRate = parseFloat(loan.interest_rate) / 100 / 12;
      const durationMonths = parseInt(loan.duration_months);
      const amount = parseFloat(loan.amount);
      const emi =
        monthlyRate === 0
          ? amount / durationMonths
          : (amount * monthlyRate * Math.pow(1 + monthlyRate, durationMonths)) /
            (Math.pow(1 + monthlyRate, durationMonths) - 1);

      const totalRepayable = emi * durationMonths;
      const amountPaid = Math.max(totalRepayable - parseFloat(loan.remaining_balance), 0);
      const monthsPaid = Math.max(
        0,
        Math.min(Math.round(amountPaid / (emi || 1)), durationMonths)
      );

      return { ...loan, emi: Math.round(emi * 1_000_000) / 1_000_000, months_paid: monthsPaid };
    });

    res.status(200).json({ loans: enriched });
  })
);

export default router;

