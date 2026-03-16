import cron from "node-cron";
import { env } from "../config/env.js";
import { db } from "../db/pool.js";
import { runInvestment } from "../services/investmentService.js";

export function startInvestmentScheduler() {
  cron.schedule(env.INVESTMENT_CRON, async () => {
    const companies = await db.query("SELECT id FROM companies");
    for (const company of companies.rows) {
      runInvestment(company.id).catch((error) => {
        console.error("Investment scheduler error", error);
      });
    }
  });
}
