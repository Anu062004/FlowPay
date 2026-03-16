import cron from "node-cron";
import { env } from "../config/env.js";
import { runPayroll } from "../services/payrollService.js";

export function startPayrollScheduler() {
  cron.schedule(env.PAYROLL_CRON, () => {
    runPayroll().catch((error) => {
      console.error("Payroll scheduler error", error);
    });
  });
}
