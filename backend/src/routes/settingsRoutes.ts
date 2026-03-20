import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/errors.js";
import { uuidQueryParam } from "../utils/validation.js";
import { getCompanySettings, upsertCompanySettings } from "../services/settingsService.js";
import { assertCompanyScope, requireCompanySession } from "../middleware/auth.js";

const router = Router();

const settingsSchema = z.object({
  profile: z.object({
    companyName: z.string().min(1),
    legalEntity: z.string(),
    companyEmail: z.string().email().or(z.literal("")),
    timeZone: z.string().min(1)
  }),
  payroll: z.object({
    payrollDay: z.string().min(1),
    currency: z.string().min(1),
    autoProcess: z.boolean(),
    emiAutoDeduction: z.boolean(),
    emailNotifications: z.boolean()
  }),
  security: z.object({
    twoFactor: z.boolean(),
    transactionApproval: z.boolean(),
    ipAllowlist: z.boolean(),
    auditLog: z.boolean(),
    sessionTimeout: z.string().min(1),
    accessPinConfigured: z.boolean().optional()
  }),
  agent: z.object({
    enabled: z.boolean(),
    executionSource: z.string().min(1),
    slippageProtection: z.boolean(),
    maxTradeSize: z.coerce.number().nonnegative(),
    riskTolerance: z.string().min(1),
    rebalanceFrequency: z.string().min(1),
    lending_paused: z.boolean().optional(),
    walletPolicy: z.object({
      allowTreasuryAllocation: z.boolean(),
      allowLoanDisbursal: z.boolean(),
      allowPayroll: z.boolean(),
      allowAaveRebalance: z.boolean(),
      maxSingleTransfer: z.coerce.number().nonnegative(),
      maxDailyOutflow: z.coerce.number().nonnegative(),
      maxLoanAmount: z.coerce.number().nonnegative(),
      maxAaveAllocationPct: z.coerce.number().min(0).max(100),
      humanReviewAbove: z.coerce.number().nonnegative()
    })
  })
});

router.get(
  "/",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    assertCompanyScope(res, companyId);
    const settings = await getCompanySettings(companyId);
    res.status(200).json({ settings });
  })
);

router.put(
  "/",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    assertCompanyScope(res, companyId);
    const payload = settingsSchema.parse(req.body);
    const settings = await upsertCompanySettings(companyId, payload);
    res.status(200).json({ settings });
  })
);

export default router;
