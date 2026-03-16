import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/errors.js";
import { uuidQueryParam } from "../utils/validation.js";
import { getCompanySettings, upsertCompanySettings } from "../services/settingsService.js";

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
    sessionTimeout: z.string().min(1)
  }),
  agent: z.object({
    enabled: z.boolean(),
    slippageProtection: z.boolean(),
    maxTradeSize: z.coerce.number().nonnegative(),
    riskTolerance: z.string().min(1),
    rebalanceFrequency: z.string().min(1)
  })
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    const settings = await getCompanySettings(companyId);
    res.status(200).json({ settings });
  })
);

router.put(
  "/",
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    const payload = settingsSchema.parse(req.body);
    const settings = await upsertCompanySettings(companyId, payload);
    res.status(200).json({ settings });
  })
);

export default router;
