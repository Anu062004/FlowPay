import express from "express";
import helmet from "helmet";
import cors from "cors";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import companyRoutes from "./routes/companyRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import loanRoutes from "./routes/loanRoutes.js";
import payrollRoutes from "./routes/payrollRoutes.js";
import treasuryRoutes from "./routes/treasuryRoutes.js";
import lendingRoutes from "./routes/lendingRoutes.js";
import transactionRoutes from "./routes/transactionRoutes.js";
import investmentRoutes from "./routes/investmentRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import agentRoutes from "./routes/agentRoutes.js";
import opsRoutes from "./routes/opsRoutes.js";
import { ApiError } from "./utils/errors.js";
import { ensureRuntimeSchema } from "./db/runtimeSchema.js";
import { startAllTreasuryWatchers } from "./services/depositWatcher.js";
import { startPayrollScheduler } from "./schedulers/payrollScheduler.js";
import { startOrchestratorScheduler } from "./schedulers/orchestratorScheduler.js";
import { startReportScheduler } from "./schedulers/reportScheduler.js";
import { startAutomationScheduler } from "./schedulers/automationScheduler.js";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: [env.APP_BASE_URL],
    credentials: true
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/companies", companyRoutes);
app.use("/employees", employeeRoutes);
app.use("/loans", loanRoutes);
app.use("/payroll", payrollRoutes);
app.use("/treasury", treasuryRoutes);
app.use("/lending", lendingRoutes);
app.use("/transactions", transactionRoutes);
app.use("/investments", investmentRoutes);
app.use("/settings", settingsRoutes);
app.use("/agents", agentRoutes);
app.use("/ops", opsRoutes);

const orchestratorEnabled = (env.ORCHESTRATOR_ENABLED ?? "true").toLowerCase() === "true";
const depositWatchersEnabled = (env.DEPOSIT_WATCHERS_ENABLED ?? "true").toLowerCase() === "true";

app.use((err: any, _req: any, res: any, _next: any) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation error", details: err.flatten() });
  }

  const isApiError =
    err instanceof ApiError ||
    err?.name === "ApiError" ||
    (typeof err?.status === "number" && typeof err?.message === "string");

  if (isApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
});

async function start() {
  await ensureRuntimeSchema();

  app.listen(env.PORT, () => {
    console.log(`FlowPay API listening on ${env.PORT}`);
    if (depositWatchersEnabled) {
      startAllTreasuryWatchers().catch((error) => {
        console.error("Failed to start deposit watchers", error);
      });
    } else {
      console.log("[DepositWatcher] Startup watchers disabled; waiting for manual start or production config.");
    }
    startPayrollScheduler();
    if (orchestratorEnabled) {
      startOrchestratorScheduler();
    } else {
      console.log("[Orchestrator] Startup scheduler disabled; waiting for external trigger.");
    }
    startReportScheduler();
    startAutomationScheduler();
  });
}

start().catch((error) => {
  console.error("Failed to start FlowPay API", error);
  process.exit(1);
});
