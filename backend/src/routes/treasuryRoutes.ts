import { Router } from "express";
import { getLatestTreasuryAllocation, getTreasuryBalance } from "../services/treasuryService.js";
import { asyncHandler, ApiError } from "../utils/errors.js";
import { uuidQueryParam } from "../utils/validation.js";
import { assertCompanyScope, requireCompanySession } from "../middleware/auth.js";

const router = Router();

router.get(
  "/balance",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    if (!companyId) {
      throw new ApiError(400, "companyId is required");
    }
    assertCompanyScope(res, companyId);
    const result = await getTreasuryBalance(companyId);
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

export default router;
