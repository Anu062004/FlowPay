import express from "express";
import { db } from "../db/pool.js";
import { env } from "../config/env.js";

const router = express.Router();

// Basic auth middleware
const auth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const masterKey = req.headers["x-master-key"];
  if (masterKey !== env.MASTER_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

router.get("/logs", auth, async (req, res, next) => {
  const companyId = req.query.companyId;
  try {
    let query = "SELECT id, timestamp, agent_name, decision, rationale, action_taken, company_id FROM agent_logs";
    const params = [];

    if (companyId) {
      query += " WHERE company_id = $1";
      params.push(companyId);
    }

    query += " ORDER BY timestamp DESC LIMIT 20";

    const result = await db.query(query, params);
    res.json({ logs: result.rows });
  } catch (error) {
    next(error);
  }
});

export default router;
