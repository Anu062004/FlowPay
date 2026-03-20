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
  const workflowId = req.query.workflowId;
  const stage = req.query.stage;
  try {
    let query =
      "SELECT id, timestamp, agent_name, decision, rationale, action_taken, company_id, workflow_id, workflow_name, stage, source, policy_result, execution_status, metadata FROM agent_logs";
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (companyId) {
      params.push(companyId);
      clauses.push(`company_id = $${params.length}`);
    }

    if (workflowId) {
      params.push(workflowId);
      clauses.push(`workflow_id = $${params.length}`);
    }

    if (stage) {
      params.push(stage);
      clauses.push(`stage = $${params.length}`);
    }

    if (clauses.length > 0) {
      query += ` WHERE ${clauses.join(" AND ")}`;
    }

    const parsedLimit = parseInt(String(req.query.limit ?? "60"), 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 250) : 60;
    params.push(limit);

    query += ` ORDER BY timestamp DESC LIMIT $${params.length}`;

    const result = await db.query(query, params);
    res.json({ logs: result.rows });
  } catch (error) {
    next(error);
  }
});

export default router;
