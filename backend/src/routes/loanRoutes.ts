import { Router } from "express";
import { z } from "zod";
import {
  approvePendingReviewLoan,
  listPendingReviewLoans,
  rejectPendingReviewLoan,
  repayLoanEmi,
  repayLoanInFull,
  requestLoan
} from "../services/loanService.js";
import { asyncHandler } from "../utils/errors.js";
import { ApiError } from "../utils/errors.js";
import {
  assertCompanyScope,
  assertEmployeeScope,
  getCompanySession,
  requireCompanySession,
  requireEmployeeSession
} from "../middleware/auth.js";

const router = Router();

const requestSchema = z.object({
  employeeId: z.string().uuid(),
  requestedAmount: z.number().positive()
});

const repaySchema = z.object({
  employeeId: z.string().uuid()
});

const repayEmiSchema = z.object({
  employeeId: z.string().uuid(),
  amount: z.number().positive()
});

const pendingReviewQuerySchema = z.object({
  companyId: z.string().uuid()
});

const rejectReviewSchema = z.object({
  reason: z.string().trim().min(2).optional()
});

router.post(
  "/request",
  requireEmployeeSession,
  asyncHandler(async (req, res) => {
    const payload = requestSchema.parse(req.body);
    assertEmployeeScope(res, payload.employeeId);
    const result = await requestLoan(payload.employeeId, payload.requestedAmount);
    res.status(200).json(result);
  })
);

router.post(
  "/:loanId/repay-full",
  requireEmployeeSession,
  asyncHandler(async (req, res) => {
    const loanId = z.string().uuid().parse(req.params.loanId);
    const payload = repaySchema.parse(req.body);
    assertEmployeeScope(res, payload.employeeId);
    const result = await repayLoanInFull(loanId, payload.employeeId);
    res.status(200).json(result);
  })
);

router.post(
  "/:loanId/repay-emi",
  requireEmployeeSession,
  asyncHandler(async (req, res) => {
    const loanId = z.string().uuid().parse(req.params.loanId);
    const payload = repayEmiSchema.parse(req.body);
    assertEmployeeScope(res, payload.employeeId);
    const result = await repayLoanEmi(loanId, payload.employeeId, payload.amount);
    res.status(200).json(result);
  })
);

router.get(
  "/pending-review",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const payload = pendingReviewQuerySchema.parse(req.query);
    assertCompanyScope(res, payload.companyId);
    const result = await listPendingReviewLoans(payload.companyId);
    res.status(200).json(result);
  })
);

router.post(
  "/:loanId/approve",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const loanId = z.string().uuid().parse(req.params.loanId);
    const session = getCompanySession(res);
    if (!session) {
      throw new ApiError(401, "Employer authentication required");
    }
    const result = await approvePendingReviewLoan(loanId, session.companyId, {
      source: "company_review",
      workflowName: "loan_review"
    });
    res.status(200).json(result);
  })
);

router.post(
  "/:loanId/reject",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const loanId = z.string().uuid().parse(req.params.loanId);
    const payload = rejectReviewSchema.parse(req.body ?? {});
    const session = getCompanySession(res);
    if (!session) {
      throw new ApiError(401, "Employer authentication required");
    }
    const result = await rejectPendingReviewLoan(loanId, session.companyId, payload.reason);
    res.status(200).json(result);
  })
);

export default router;
