import { Router } from "express";
import { z } from "zod";
import { addEmployee, activateEmployee, registerEmployeeWallet, resendEmployeeInvite } from "../services/employeeService.js";
import { getEmployeeWalletDetails, withdrawEmployeeFunds } from "../services/employeeWalletService.js";
import { getCompanySettings } from "../services/settingsService.js";
import { asyncHandler } from "../utils/errors.js";
import { db } from "../db/pool.js";
import { uuidQueryParam } from "../utils/validation.js";
import { getPayrollScheduleStatus } from "../utils/payrollSchedule.js";
import {
  authenticateEmployee,
  clearEmployeeSession,
  createEmployeeSession,
  getEmployeeProfile,
  requestEmployeeRecovery,
  resetEmployeeRecovery
} from "../services/authService.js";
import {
  assertCompanyScope,
  assertEmployeeScope,
  getCompanySession,
  getEmployeeSession,
  requireCompanySession,
  requireEmployeeSession
} from "../middleware/auth.js";
import { syncEmployeeCreditScoreOnCore } from "../services/contractService.js";

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

const recoveryRequestSchema = z.object({
  email: z.string().trim().email()
});

const recoveryResetSchema = z.object({
  token: z.string().trim().min(10),
  password: z.string().min(8)
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
    const settings = await getCompanySettings(companyId);
    const payrollSchedule = getPayrollScheduleStatus({
      payrollDayLabel: settings.payroll.payrollDay,
      companyTimeZone: settings.profile.timeZone
    });
    const result = await db.query(
      `SELECT
         e.id,
         e.company_id,
         e.full_name,
         COALESCE(e.email, '') AS email,
         e.salary,
         e.credit_score,
         e.status,
         e.created_at,
         w.wallet_address,
         COALESCE(loan_summary.active_loans, 0) AS active_loans,
         COALESCE(loan_summary.outstanding_balance, 0) AS outstanding_balance,
         loan_summary.loan_status,
         payroll_summary.last_payroll_at,
         COALESCE(payroll_summary.paid_this_period, false) AS paid_this_period
       FROM employees e
       LEFT JOIN wallets w ON e.wallet_id = w.id
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (WHERE l.status = 'active') AS active_loans,
           COALESCE(SUM(l.remaining_balance) FILTER (WHERE l.status = 'active'), 0) AS outstanding_balance,
           MAX(CASE WHEN l.status = 'active' THEN l.status ELSE NULL END) AS loan_status
         FROM loans l
         WHERE l.employee_id = e.id
       ) loan_summary ON true
       LEFT JOIN LATERAL (
         SELECT
           MAX(pd.created_at) AS last_payroll_at,
           COALESCE(
             BOOL_OR(
               pd.payroll_month = date_trunc('month', now() AT TIME ZONE 'UTC')::date
             ),
             false
           ) AS paid_this_period
         FROM payroll_disbursements pd
         WHERE pd.employee_id = e.id
       ) payroll_summary ON true
       WHERE e.company_id = $1
      ORDER BY e.created_at DESC`,
      [companyId]
    );
    const employees = await Promise.all(result.rows.map(async (row) => {
        let creditScore = row.credit_score;
      if (row.wallet_address) {
        try {
          creditScore = await syncEmployeeCreditScoreOnCore(row.wallet_address, row.salary, {
            companyId: row.company_id ?? undefined
          });
          if (creditScore !== row.credit_score) {
            await db.query("UPDATE employees SET credit_score = $1 WHERE id = $2", [creditScore, row.id]);
          }
        } catch {
          creditScore = row.credit_score;
        }
      }

      return {
        ...row,
        credit_score: creditScore,
        payroll_status: row.paid_this_period
          ? "paid"
          : payrollSchedule.due
            ? "due"
            : "scheduled"
      };
    }));
    res.status(200).json({ employees });
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
  "/recover/request",
  asyncHandler(async (req, res) => {
    const payload = recoveryRequestSchema.parse(req.body);
    await requestEmployeeRecovery(payload.email);
    res.status(200).json({
      status: "ok",
      message: "If an employee account exists for that email, a recovery link has been sent."
    });
  })
);

router.post(
  "/recover/reset",
  asyncHandler(async (req, res) => {
    const payload = recoveryResetSchema.parse(req.body);
    const employee = await resetEmployeeRecovery(payload.token, payload.password);
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
  "/session",
  requireEmployeeSession,
  asyncHandler(async (_req, res) => {
    const session = getEmployeeSession(res);
    const employee = await getEmployeeProfile(session!.employeeId);
    res.status(200).json({ employee });
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
