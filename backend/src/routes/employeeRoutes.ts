import { Router } from "express";
import { z } from "zod";
import { addEmployee, activateEmployee, registerEmployeeWallet, resendEmployeeInvite } from "../services/employeeService.js";
import { getEmployeeWalletDetails, withdrawEmployeeFunds } from "../services/employeeWalletService.js";
import { asyncHandler } from "../utils/errors.js";
import { db } from "../db/pool.js";
import { uuidQueryParam } from "../utils/validation.js";
import {
  authenticateEmployee,
  clearEmployeeSession,
  createEmployeeSession,
  getEmployeeProfile
} from "../services/authService.js";
import {
  assertCompanyScope,
  assertEmployeeScope,
  getCompanySession,
  requireCompanySession,
  requireEmployeeSession
} from "../middleware/auth.js";

const router = Router();

const addSchema = z.object({
  companyId: z.string().uuid(),
  fullName: z.string().min(2),
  email: z.string().email(),
  salary: z.number().positive(),
  creditScore: z.number().int().min(300).max(850).optional()
});

const selfRegisterSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email().optional(),
  password: z.string().min(8)
});

const activateSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8)
});

const loginSchema = z.object({
  access: z.string().trim().min(3),
  password: z.string().min(8),
  email: z.string().trim().email().optional()
});

const withdrawSchema = z.object({
  destinationAddress: z.string().min(42),
  amount: z.number().positive()
});

router.get(
  "/",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    assertCompanyScope(res, companyId);
    const result = await db.query(
      `SELECT
         e.id,
         e.full_name,
         COALESCE(e.email, '') AS email,
         e.salary,
         e.credit_score,
         e.status,
         e.created_at,
         w.wallet_address,
         COUNT(l.id) FILTER (WHERE l.status = 'active') AS active_loans,
         COALESCE(SUM(l.remaining_balance) FILTER (WHERE l.status = 'active'), 0) AS outstanding_balance,
         MAX(CASE WHEN l.status = 'active' THEN l.status ELSE NULL END) AS loan_status
       FROM employees e
       LEFT JOIN wallets w ON e.wallet_id = w.id
       LEFT JOIN loans l ON l.employee_id = e.id
       WHERE e.company_id = $1
       GROUP BY e.id, w.wallet_address
       ORDER BY e.created_at DESC`,
      [companyId]
    );
    res.status(200).json({ employees: result.rows });
  })
);

router.post(
  "/register-self",
  asyncHandler(async (req, res) => {
    const payload = selfRegisterSchema.parse(req.body);
    const result = await registerEmployeeWallet(payload);
    await createEmployeeSession(res, result.employee.id, result.employee.company_id ?? null);
    res.status(201).json(result);
  })
);

router.post(
  "/add",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const payload = addSchema.parse(req.body);
    assertCompanyScope(res, payload.companyId);
    const result = await addEmployee(payload);
    res.status(201).json(result);
  })
);

router.post(
  "/activate",
  asyncHandler(async (req, res) => {
    const payload = activateSchema.parse(req.body);
    const result = await activateEmployee(payload.token, payload.password);
    await createEmployeeSession(res, result.employeeId, result.employee.company_id ?? null);
    res.status(200).json(result);
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const payload = loginSchema.parse(req.body);
    const employee = await authenticateEmployee(payload);
    await createEmployeeSession(res, employee.id, employee.company_id ?? null);
    res.status(200).json({ employee });
  })
);

router.post(
  "/logout",
  asyncHandler(async (_req, res) => {
    clearEmployeeSession(res);
    res.status(200).json({ status: "ok" });
  })
);

router.get(
  "/:id",
  requireEmployeeSession,
  asyncHandler(async (req, res) => {
    const employeeId = z.string().uuid().parse(req.params.id);
    assertEmployeeScope(res, employeeId);
    const employee = await getEmployeeProfile(employeeId);
    res.status(200).json(employee);
  })
);

router.get(
  "/:id/wallet",
  requireEmployeeSession,
  asyncHandler(async (req, res) => {
    const employeeId = z.string().uuid().parse(req.params.id);
    assertEmployeeScope(res, employeeId);
    const result = await getEmployeeWalletDetails(employeeId);
    res.status(200).json(result);
  })
);

router.post(
  "/:id/withdraw",
  requireEmployeeSession,
  asyncHandler(async (req, res) => {
    const employeeId = z.string().uuid().parse(req.params.id);
    assertEmployeeScope(res, employeeId);
    const payload = withdrawSchema.parse(req.body);
    const result = await withdrawEmployeeFunds(employeeId, payload.destinationAddress, payload.amount);
    res.status(200).json(result);
  })
);

router.post(
  "/:id/resend-invite",
  requireCompanySession,
  asyncHandler(async (req, res) => {
    const employeeId = z.string().uuid().parse(req.params.id);
    const companySession = getCompanySession(res);
    const result = await resendEmployeeInvite(employeeId, companySession!.companyId);
    res.status(200).json(result);
  })
);

export default router;
