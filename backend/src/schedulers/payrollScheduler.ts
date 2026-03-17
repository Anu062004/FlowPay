import cron from "node-cron";
import { env } from "../config/env.js";
import { requestPayrollApproval } from "../services/payrollService.js";

export function startPayrollScheduler() {
  cron.schedule(env.PAYROLL_CRON, () => {
    requestPayrollApproval().catch((error) => {
      console.error("Payroll scheduler error", error);
    });
  });
}
