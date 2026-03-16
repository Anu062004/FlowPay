import { Router } from "express";
import { z } from "zod";
import { addEmployee, activateEmployee } from "../services/employeeService.js";
import { asyncHandler } from "../utils/errors.js";
import { db } from "../db/pool.js";
import { uuidQueryParam } from "../utils/validation.js";

const router = Router();

const addSchema = z.object({
  companyId: z.string().uuid(),
  fullName: z.string().min(2),
  email: z.string().email(),
  salary: z.number().positive(),
  creditScore: z.number().int().min(300).max(850).optional()
});

const activateSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8)
});

// ── GET /employees?companyId= ─────────────────────────────────
// List all employees for a company with wallet address and loan info
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const companyId = uuidQueryParam.parse(req.query.companyId);
    const result = await db.query(
      `SELECT
         e.id,
         e.full_name,
         e.email,
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

// ── GET /employees/:id ────────────────────────────────────────
// Single employee detail (for employee portal)
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const employeeId = z.string().uuid().parse(req.params.id);
    const result = await db.query(
      `SELECT
         e.id,
         e.full_name,
         e.email,
         e.salary,
         e.credit_score,
         e.status,
         e.created_at,
         w.wallet_address,
         c.id AS company_id,
         c.name AS company_name
       FROM employees e
       LEFT JOIN wallets w ON e.wallet_id = w.id
       LEFT JOIN companies c ON e.company_id = c.id
       WHERE e.id = $1`,
      [employeeId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Employee not found" });
    }
    res.status(200).json(result.rows[0]);
  })
);

router.post(
  "/add",
  asyncHandler(async (req, res) => {
    const payload = addSchema.parse(req.body);
    const result = await addEmployee(payload);
    res.status(201).json(result);
  })
);

router.post(
  "/activate",
  asyncHandler(async (req, res) => {
    const payload = activateSchema.parse(req.body);
    const result = await activateEmployee(payload.token, payload.password);
    res.status(200).json(result);
  })
);

export default router;
