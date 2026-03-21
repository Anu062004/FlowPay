import cron from "node-cron";
import { env } from "../config/env.js";
import { processAutomatedPayrollSchedules } from "../services/payrollAutomationService.js";

export function startPayrollScheduler() {
  cron.schedule(env.PAYROLL_AUTOMATION_CRON, () => {
    processAutomatedPayrollSchedules().catch((error) => {
      console.error("Payroll scheduler error", error);
    });
  });
}
