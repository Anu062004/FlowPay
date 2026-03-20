import { Router } from "express";
import { z } from "zod";
import { registerCompany } from "../services/companyService.js";
import { asyncHandler } from "../utils/errors.js";
import {
  authenticateCompany,
  clearCompanySession,
  createCompanySession,
  getCompanyListForOwner,
  getCompanyProfile,
  updateCompanyAccessPin
} from "../services/authService.js";
import { assertCompanyScope, getCompanySession, requireCompanySession } from "../middleware/auth.js";

const router = Router();

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  accessPin: z.string().trim().min(4).max(64)
});

const loginSchema = z.object({
  access: z.string().trim().min(3),
  accessPin: z.string().trim().min(4).max(64),
  email: z.string().trim().email().optional()
});

const accessPinSchema = z.object({
  accessPin: z.string().trim().min(4).max(64)
});

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const payload = registerSchema.parse(req.body);
    const result = await registerCompany(payload);
    await createCompanySession(res, result.company.id);
    res.status(201).json(result);
  })
);

router.get(
  "/",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const session = getCompanySession(res);
    const companies = await getCompanyListForOwner(session!.companyId);
    res.status(200).json({ companies });
  })
);

router.post(
  "/login",
  asyncHandler(async (_req, res) => {
    const payload = loginSchema.parse(_req.body);
    const company = await authenticateCompany(payload);
    await createCompanySession(res, company.id);
    res.status(200).json({ company });
  })
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    clearCompanySession(res);
    res.status(200).json({ status: "ok" });
  })
);

router.post(
  "/access-pin",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const payload = accessPinSchema.parse(req.body);
    const session = getCompanySession(res);
    await updateCompanyAccessPin(session!.companyId, payload.accessPin);
    await createCompanySession(res, session!.companyId);
    res.status(200).json({ status: "ok", accessPinConfigured: true });
  })
);

router.get(
  "/:id",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const companyId = z.string().uuid().parse(req.params.id);
    assertCompanyScope(res, companyId);
    const company = await getCompanyProfile(companyId);
    res.status(200).json(company);
  })
);

export default router;
