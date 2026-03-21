import { Router } from "express";
import { z } from "zod";
import {
  getLatestTreasuryAllocation,
  getTreasuryWalletDetails,
  withdrawTreasuryFunds
} from "../services/treasuryService.js";
import { asyncHandler, ApiError } from "../utils/errors.js";
import { uuidQueryParam } from "../utils/validation.js";
import { assertCompanyScope, requireCompanySession } from "../middleware/auth.js";

const router = Router();

const withdrawSchema = z.object({
  companyId: z.string().uuid(),
  destinationAddress: z.string().min(42),
  amount: z.number().positive()
});

router.get(
  "/balance",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    if (!companyId) {
      throw new ApiError(400, "companyId is required");
    }
    assertCompanyScope(res, companyId);
    const result = await getTreasuryWalletDetails(companyId);
    res.status(200).json(result);
  })
);

router.get(
  "/allocation",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    if (!companyId) {
      throw new ApiError(400, "companyId is required");
    }
    assertCompanyScope(res, companyId);
    const result = await getLatestTreasuryAllocation(companyId);
    res.status(200).json(result);
  })
);

router.post(
  "/withdraw",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const payload = withdrawSchema.parse(req.body);
    assertCompanyScope(res, payload.companyId);
    const result = await withdrawTreasuryFunds(
      payload.companyId,
      payload.destinationAddress,
      payload.amount
    );
    res.status(200).json(result);
  })
);

export default router;
