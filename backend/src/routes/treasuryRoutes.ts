import { Router } from "express";
import { getTreasuryBalance } from "../services/treasuryService.js";
import { asyncHandler, ApiError } from "../utils/errors.js";
import { uuidQueryParam } from "../utils/validation.js";

const router = Router();

router.get(
  "/balance",
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    if (!companyId) {
      throw new ApiError(400, "companyId is required");
    }
    const result = await getTreasuryBalance(companyId);
    res.status(200).json(result);
  })
);

export default router;
