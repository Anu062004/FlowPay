import { Router } from "express";
import { z } from "zod";
import { repayLoanInFull, requestLoan } from "../services/loanService.js";
import { asyncHandler } from "../utils/errors.js";
import { assertEmployeeScope, requireEmployeeSession } from "../middleware/auth.js";

const router = Router();

const requestSchema = z.object({
  employeeId: z.string().uuid(),
  requestedAmount: z.number().positive()
});

const repaySchema = z.object({
  employeeId: z.string().uuid()
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

export default router;
