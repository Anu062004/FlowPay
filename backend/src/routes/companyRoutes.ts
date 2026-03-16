import { Router } from "express";
import { z } from "zod";
import { registerCompany } from "../services/companyService.js";
import { db } from "../db/pool.js";
import { asyncHandler } from "../utils/errors.js";

const router = Router();

const registerSchema = z.object({
  name: z.string().min(2)
});

const idSchema = z.string().uuid();

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const payload = registerSchema.parse(req.body);
    const result = await registerCompany(payload.name);
    res.status(201).json(result);
  })
);

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await db.query(
      `SELECT c.id, c.name, c.created_at, w.wallet_address as treasury_address
       FROM companies c
       LEFT JOIN wallets w ON c.treasury_wallet_id = w.id
       ORDER BY c.created_at DESC`
    );
    res.status(200).json({ companies: result.rows });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const companyId = idSchema.parse(req.params.id);
    const result = await db.query(
      `SELECT c.id, c.name, c.created_at, c.treasury_wallet_id, w.wallet_address as treasury_address
       FROM companies c
       LEFT JOIN wallets w ON c.treasury_wallet_id = w.id
       WHERE c.id = $1`,
      [companyId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Company not found" });
    }
    res.status(200).json(result.rows[0]);
  })
);

export default router;
