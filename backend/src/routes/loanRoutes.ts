import { Router } from "express";
import { z } from "zod";
import { requestLoan } from "../services/loanService.js";
import { asyncHandler } from "../utils/errors.js";

const router = Router();

const requestSchema = z.object({
  employeeId: z.string().uuid(),
  requestedAmount: z.number().positive()
});

router.post(
  "/request",
  asyncHandler(async (req, res) => {
    const payload = requestSchema.parse(req.body);
    const result = await requestLoan(payload.employeeId, payload.requestedAmount);
    res.status(200).json(result);
  })
);

export default router;
