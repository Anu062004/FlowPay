import cron from "node-cron";
import { env } from "../config/env.js";
import { runAutomationJob } from "../services/automationService.js";

function schedule(jobName: "finance" | "backend" | "blockchain" | "monitoring" | "support" | "browser", cronExpr: string) {
  cron.schedule(cronExpr, () => {
    runAutomationJob(jobName).catch((error) => {
      console.error(`[Automation] ${jobName} scheduler error`, error);
    });
  });
}

export function startAutomationScheduler() {
  schedule("finance", env.FINANCE_DAILY_CRON);
  schedule("backend", env.BACKEND_WORKFLOW_CRON);
  schedule("blockchain", env.BLOCKCHAIN_MONITOR_CRON);
  schedule("monitoring", env.HEALTH_MONITOR_CRON);
  schedule("support", env.ADMIN_SUPPORT_CRON);
  schedule("browser", env.BROWSER_AUTOMATION_CRON);
}
