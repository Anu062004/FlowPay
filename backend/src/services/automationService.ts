import { CronExpressionParser } from "cron-parser";
import { env } from "../config/env.js";
import { db } from "../db/pool.js";
import { requestPayrollApproval } from "./payrollService.js";
import { getTreasuryBalance } from "./treasuryService.js";
import { createOpsTaskIfNotRecent } from "./opsService.js";
import { getAdminSupportInsights } from "./adminSupportService.js";
import { sendAutomationNotification } from "./notificationService.js";
import { getEthPrice } from "./priceService.js";
import { startAllTreasuryWatchers } from "./depositWatcher.js";
import { getTokenTransfers } from "./indexerService.js";
import { withRpcFailover } from "./rpcService.js";

export type AutomationJobName =
  | "finance"
  | "backend"
  | "blockchain"
  | "monitoring"
  | "support"
  | "browser"
  | "all";

type AutomationRunRecord = {
  job: AutomationJobName;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  summary: Record<string, unknown>;
  errors: string[];
};

const runStatus = new Map<AutomationJobName, AutomationRunRecord>();

type CompanyRow = {
  id: string;
  name: string;
};

type AutomationRunOptions = {
  companyId?: string;
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

function parseIntSafe(value: string, fallback: number): number {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function dedupeWindowMinutes(): number {
  return parseIntSafe(env.AUTOMATION_DEDUPE_WINDOW_MIN, 240);
}

async function listCompanies(companyId?: string): Promise<CompanyRow[]> {
  if (companyId) {
    const result = await db.query("SELECT id, name FROM companies WHERE id = $1", [companyId]);
    return result.rows as CompanyRow[];
  }
  const result = await db.query("SELECT id, name FROM companies ORDER BY created_at ASC");
  return result.rows as CompanyRow[];
}

function getHoursToNextPayroll(): number {
  const interval = CronExpressionParser.parse(env.PAYROLL_CRON);
  const nextPayroll = interval.next().toDate();
  return (nextPayroll.getTime() - Date.now()) / (1000 * 60 * 60);
}

async function runFinanceAutomation(companyId?: string): Promise<Record<string, unknown>> {
  const companies = await listCompanies(companyId);
  const createdTasks: Record<string, number> = {};
  let processed = 0;
  const hoursToPayroll = getHoursToNextPayroll();
  const payrollLookahead = parseIntSafe(env.PAYROLL_PREP_LOOKAHEAD_HOURS, 72);

  for (const company of companies) {
    processed += 1;
    const employeeStatsResult = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active') AS active_employees,
         COALESCE(SUM(salary), 0) AS total_salary
       FROM employees
       WHERE company_id = $1`,
      [company.id]
    );
    const loanStatsResult = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE l.status = 'active') AS active_loans,
         COALESCE(SUM(l.remaining_balance) FILTER (WHERE l.status = 'active'), 0) AS outstanding_loans
       FROM loans l
       JOIN employees e ON e.id = l.employee_id
       WHERE e.company_id = $1`,
      [company.id]
    );
    const txStatsResult = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE t.created_at >= date_trunc('day', now())) AS tx_count_today,
         COALESCE(SUM(t.amount) FILTER (WHERE t.created_at >= date_trunc('day', now())), 0) AS tx_amount_today,
         COUNT(*) FILTER (WHERE t.tx_hash IS NULL) AS pending_settlement_count
       FROM transactions t
       JOIN wallets w ON w.id = t.wallet_id
       JOIN companies c ON c.treasury_wallet_id = w.id
       WHERE c.id = $1`,
      [company.id]
    );

    let treasury: Record<string, unknown> | null = null;
    try {
      treasury = await getTreasuryBalance(company.id);
    } catch {
      treasury = null;
    }

    const snapshotPayload = {
      companyId: company.id,
      companyName: company.name,
      generatedAt: new Date().toISOString(),
      hoursToNextPayroll: parseFloat(hoursToPayroll.toFixed(2)),
      employees: employeeStatsResult.rows[0],
      loans: loanStatsResult.rows[0],
      treasury,
      transactions: txStatsResult.rows[0]
    };
    const snapshotResult = await createOpsTaskIfNotRecent({
      companyId: company.id,
      type: "finance_snapshot",
      subject: "FlowPay daily balance snapshot",
      payload: snapshotPayload,
      dedupeWindowMinutes: 24 * 60
    });
    if (snapshotResult.created) {
      createdTasks.finance_snapshot = (createdTasks.finance_snapshot ?? 0) + 1;
    }

    const reconciliationPayload = {
      companyId: company.id,
      generatedAt: new Date().toISOString(),
      txCountToday: toNumber(txStatsResult.rows[0]?.tx_count_today),
      txAmountToday: toNumber(txStatsResult.rows[0]?.tx_amount_today),
      pendingSettlementCount: toNumber(txStatsResult.rows[0]?.pending_settlement_count)
    };
    const reconciliationResult = await createOpsTaskIfNotRecent({
      companyId: company.id,
      type: "reconciliation_report",
      subject: "FlowPay reconciliation check",
      payload: reconciliationPayload,
      dedupeWindowMinutes: parseIntSafe(env.BLOCKCHAIN_STALLED_TX_MIN, 30)
    });
    if (reconciliationResult.created) {
      createdTasks.reconciliation_report = (createdTasks.reconciliation_report ?? 0) + 1;
    }

    if (hoursToPayroll <= payrollLookahead) {
      const payrollPrepResult = await createOpsTaskIfNotRecent({
        companyId: company.id,
        type: "payroll_prep",
        subject: "FlowPay payroll prep window opened",
        payload: {
          companyId: company.id,
          companyName: company.name,
          hoursToPayroll: parseFloat(hoursToPayroll.toFixed(2)),
          activeEmployees: toNumber(employeeStatsResult.rows[0]?.active_employees),
          totalSalary: toNumber(employeeStatsResult.rows[0]?.total_salary),
          treasuryBalance: treasury ? toNumber((treasury as any).balance) : null
        },
        dedupeWindowMinutes: 8 * 60
      });
      if (payrollPrepResult.created) {
        createdTasks.payroll_prep = (createdTasks.payroll_prep ?? 0) + 1;
      }
    }

    const eodResult = await createOpsTaskIfNotRecent({
      companyId: company.id,
      type: "eod_summary",
      subject: "FlowPay end-of-day summary",
      payload: {
        companyId: company.id,
        companyName: company.name,
        generatedAt: new Date().toISOString(),
        treasury,
        employees: employeeStatsResult.rows[0],
        loans: loanStatsResult.rows[0],
        transactions: txStatsResult.rows[0]
      },
      dedupeWindowMinutes: 24 * 60
    });
    if (eodResult.created) {
      createdTasks.eod_summary = (createdTasks.eod_summary ?? 0) + 1;
    }
  }

  return {
    processedCompanies: processed,
    createdTasks
  };
}

async function runBackendWorkflowAutomation(companyId?: string): Promise<Record<string, unknown>> {
  const companies = await listCompanies(companyId);
  const companyIds = companies.map((company) => company.id);

  const hoursToPayroll = getHoursToNextPayroll();
  const payrollLookahead = parseIntSafe(env.PAYROLL_PREP_LOOKAHEAD_HOURS, 72);
  let payrollRequests = 0;
  if (hoursToPayroll <= payrollLookahead) {
    if (companyId) {
      const result = await requestPayrollApproval(companyId);
      payrollRequests += toNumber(result.requested);
    } else {
      const result = await requestPayrollApproval();
      payrollRequests += toNumber(result.requested);
    }
  }

  let unsyncedLoans = 0;
  let staleOpsItems = 0;
  for (const id of companyIds) {
    const unsyncedResult = await db.query(
      `SELECT l.id, e.id AS employee_id, e.full_name, l.amount, l.interest_rate, l.duration_months, l.updated_at
       FROM loans l
       JOIN employees e ON e.id = l.employee_id
       WHERE e.company_id = $1
         AND l.status = 'active'
         AND l.contract_synced = false
         AND l.updated_at < now() - interval '20 minutes'
       ORDER BY l.updated_at ASC
       LIMIT 25`,
      [id]
    );
    unsyncedLoans += unsyncedResult.rowCount ?? 0;

    if ((unsyncedResult.rowCount ?? 0) > 0) {
      await createOpsTaskIfNotRecent({
        companyId: id,
        type: "workflow_retry",
        subject: "FlowPay contract sync retry queue",
        payload: {
          companyId: id,
          issue: "loan_contract_sync_failed",
          generatedAt: new Date().toISOString(),
          loans: unsyncedResult.rows
        },
        dedupeWindowMinutes: dedupeWindowMinutes()
      });
    }

    const staleTaskResult = await db.query(
      `SELECT id, type, subject, created_at
       FROM ops_tasks
       WHERE company_id = $1
         AND status = 'sent'
         AND created_at < now() - interval '12 hours'
       ORDER BY created_at ASC
       LIMIT 25`,
      [id]
    );
    staleOpsItems += staleTaskResult.rowCount ?? 0;

    if ((staleTaskResult.rowCount ?? 0) > 0) {
      await createOpsTaskIfNotRecent({
        companyId: id,
        type: "support_ticket",
        subject: "FlowPay stale ops queue requires attention",
        payload: {
          companyId: id,
          issue: "stale_sent_tasks",
          generatedAt: new Date().toISOString(),
          staleTasks: staleTaskResult.rows
        },
        dedupeWindowMinutes: dedupeWindowMinutes()
      });
    }
  }

  if (unsyncedLoans > 0 || staleOpsItems > 0) {
    await sendAutomationNotification({
      severity: "warning",
      title: "Backend workflow anomalies detected",
      message: `Unsynced loans: ${unsyncedLoans}, stale sent tasks: ${staleOpsItems}.`,
      companyId,
      payload: { unsyncedLoans, staleOpsItems }
    });
  }

  return {
    companies: companies.length,
    hoursToPayroll: parseFloat(hoursToPayroll.toFixed(2)),
    payrollRequests,
    unsyncedLoans,
    staleOpsItems
  };
}

async function runBlockchainAutomation(companyId?: string): Promise<Record<string, unknown>> {
  const stalledMinutes = parseIntSafe(env.BLOCKCHAIN_STALLED_TX_MIN, 30);
  const params: unknown[] = [String(stalledMinutes)];
  let clause = "";
  if (companyId) {
    params.push(companyId);
    clause = "AND c.id = $2";
  }

  const stalledSettlementResult = await db.query(
    `SELECT c.id AS company_id,
            COUNT(*) AS stalled_count,
            COALESCE(SUM(t.amount), 0) AS stalled_amount
     FROM transactions t
     JOIN wallets w ON w.id = t.wallet_id
     JOIN companies c ON c.treasury_wallet_id = w.id
     WHERE t.type IN ('payroll', 'loan_disbursement', 'investment', 'treasury_allocation')
       AND t.tx_hash IS NULL
       AND t.created_at < now() - ($1::text || ' minutes')::interval
       ${clause}
     GROUP BY c.id`,
    params
  );

  let syncFailedPositionsRows: Array<{ company_id: string; failed_positions: string }> = [];
  try {
    const syncFailedPositions = await db.query(
      `SELECT company_id, COUNT(*) AS failed_positions
       FROM investment_positions
       WHERE status = 'sync_failed'
         ${companyId ? "AND company_id = $1" : ""}
       GROUP BY company_id`,
      companyId ? [companyId] : []
    );
    syncFailedPositionsRows = syncFailedPositions.rows as Array<{
      company_id: string;
      failed_positions: string;
    }>;
  } catch {
    syncFailedPositionsRows = [];
  }

  let settlementAlertsCreated = 0;

  for (const row of stalledSettlementResult.rows) {
    const result = await createOpsTaskIfNotRecent({
      companyId: row.company_id as string,
      type: "settlement_alert",
      subject: "FlowPay settlement anomaly detected",
      payload: {
        companyId: row.company_id,
        generatedAt: new Date().toISOString(),
        stalledSettlementCount: toNumber(row.stalled_count),
        stalledSettlementAmount: toNumber(row.stalled_amount),
        stalledMinutes
      },
      dedupeWindowMinutes: dedupeWindowMinutes()
    });
    if (result.created) {
      settlementAlertsCreated += 1;
    }
  }

  for (const row of syncFailedPositionsRows) {
    const result = await createOpsTaskIfNotRecent({
      companyId: row.company_id as string,
      type: "settlement_alert",
      subject: "FlowPay investment sync failure",
      payload: {
        companyId: row.company_id,
        generatedAt: new Date().toISOString(),
        failedPositions: toNumber(row.failed_positions),
        issue: "investment_sync_failed"
      },
      dedupeWindowMinutes: dedupeWindowMinutes()
    });
    if (result.created) {
      settlementAlertsCreated += 1;
    }
  }

  const stalledCount = stalledSettlementResult.rows.reduce(
    (acc, row) => acc + toNumber(row.stalled_count),
    0
  );
  const failedPositions = syncFailedPositionsRows.reduce(
    (acc, row) => acc + toNumber(row.failed_positions),
    0
  );

  if (stalledCount > 0 || failedPositions > 0) {
    await sendAutomationNotification({
      severity: "critical",
      title: "Blockchain settlement risk detected",
      message: `Stalled settlements: ${stalledCount}, sync-failed positions: ${failedPositions}.`,
      companyId,
      payload: { stalledCount, failedPositions }
    });
  }

  return {
    stalledCount,
    failedPositions,
    settlementAlertsCreated
  };
}

async function runMonitoringAutomation(companyId?: string): Promise<Record<string, unknown>> {
  const checks: Array<{ name: string; ok: boolean; details?: string }> = [];
  const depositWatchersEnabled = (env.DEPOSIT_WATCHERS_ENABLED ?? "true").toLowerCase() === "true";

  try {
    await db.query("SELECT 1");
    checks.push({ name: "database", ok: true });
  } catch (error) {
    checks.push({
      name: "database",
      ok: false,
      details: error instanceof Error ? error.message : "Database check failed"
    });
  }

  try {
    await withRpcFailover("monitoring rpc health check", (provider) => provider.getBlockNumber());
    checks.push({ name: "rpc", ok: true });
  } catch (error) {
    checks.push({
      name: "rpc",
      ok: false,
      details: error instanceof Error ? error.message : "RPC health check failed"
    });
  }

  try {
    await getEthPrice();
    checks.push({ name: "price_feed", ok: true });
  } catch (error) {
    checks.push({
      name: "price_feed",
      ok: false,
      details: error instanceof Error ? error.message : "Price feed health check failed"
    });
  }

  if (env.WDK_INDEXER_API_KEY && env.TREASURY_TOKEN_SYMBOL) {
    try {
      const companies = await listCompanies(companyId);
      if (companies.length > 0) {
        const walletResult = await db.query(
          `SELECT w.wallet_address
           FROM companies c
           JOIN wallets w ON c.treasury_wallet_id = w.id
           WHERE c.id = $1`,
          [companies[0].id]
        );
        if ((walletResult.rowCount ?? 0) > 0) {
          await getTokenTransfers({
            blockchain: env.TREASURY_TOKEN_BLOCKCHAIN,
            token: env.TREASURY_TOKEN_SYMBOL.toLowerCase(),
            address: walletResult.rows[0].wallet_address as string,
            limit: 1
          });
        }
      }
      checks.push({ name: "indexer", ok: true });
    } catch (error) {
      checks.push({
        name: "indexer",
        ok: false,
        details: error instanceof Error ? error.message : "Indexer check failed"
      });
    }
  }

  if (depositWatchersEnabled) {
    try {
      await startAllTreasuryWatchers();
      checks.push({ name: "watcher_recovery", ok: true });
    } catch (error) {
      checks.push({
        name: "watcher_recovery",
        ok: false,
        details: error instanceof Error ? error.message : "Watcher recovery failed"
      });
    }
  } else {
    checks.push({ name: "watcher_recovery", ok: true, details: "Deposit watchers disabled by config" });
  }

  const failedChecks = checks.filter((check) => !check.ok);
  if (failedChecks.length > 0) {
    const companies = await listCompanies(companyId);
    for (const company of companies) {
      await createOpsTaskIfNotRecent({
        companyId: company.id,
        type: "monitoring_alert",
        subject: "FlowPay infrastructure monitoring alert",
        payload: {
          companyId: company.id,
          generatedAt: new Date().toISOString(),
          failedChecks
        },
        dedupeWindowMinutes: dedupeWindowMinutes()
      });
    }

    await sendAutomationNotification({
      severity: "critical",
      title: "FlowPay monitoring alert",
      message: `Failed checks: ${failedChecks.map((check) => check.name).join(", ")}`,
      companyId,
      payload: { failedChecks }
    });
  }

  return {
    checks,
    failedChecks: failedChecks.length
  };
}

async function runSupportAutomation(companyId?: string): Promise<Record<string, unknown>> {
  const companies = await listCompanies(companyId);
  let reportsCreated = 0;

  for (const company of companies) {
    const insights = await getAdminSupportInsights(company.id);
    const result = await createOpsTaskIfNotRecent({
      companyId: company.id,
      type: "admin_report",
      subject: "FlowPay admin support digest",
      payload: {
        companyId: company.id,
        companyName: company.name,
        generatedAt: insights.generatedAt,
        failuresToday: insights.failuresToday,
        pendingApprovals: insights.pendingApprovals,
        topRiskAccounts: insights.topRiskAccounts,
        answers: {
          whatFailedToday:
            insights.failuresToday.count === 0
              ? "No failures detected today."
              : `${insights.failuresToday.count} failures detected today.`,
          pendingApprovals:
            insights.pendingApprovals.count === 0
              ? "No pending approvals."
              : `${insights.pendingApprovals.count} pending approvals.`,
          topRiskAccounts:
            insights.topRiskAccounts.length === 0
              ? "No high-risk accounts found."
              : `${insights.topRiskAccounts.length} top risk accounts listed.`
        }
      },
      dedupeWindowMinutes: 6 * 60
    });
    if (result.created) {
      reportsCreated += 1;
    }
  }

  return {
    companies: companies.length,
    reportsCreated
  };
}

type BrowserAutomationTask = {
  companyId: string;
  url: string;
  instructions: string;
  label?: string;
  recipientEmail?: string;
  metadata?: Record<string, unknown>;
};

function parseBrowserAutomationTasks(): BrowserAutomationTask[] {
  const raw = env.BROWSER_AUTOMATION_TASKS_JSON?.trim();
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const tasks: BrowserAutomationTask[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const companyIdValue = typeof record.companyId === "string" ? record.companyId.trim() : "";
    const urlValue = typeof record.url === "string" ? record.url.trim() : "";
    const instructionsValue =
      typeof record.instructions === "string" ? record.instructions.trim() : "";
    if (!companyIdValue || !urlValue || !instructionsValue) {
      continue;
    }
    tasks.push({
      companyId: companyIdValue,
      url: urlValue,
      instructions: instructionsValue,
      label: typeof record.label === "string" ? record.label.trim() : undefined,
      recipientEmail:
        typeof record.recipientEmail === "string" ? record.recipientEmail.trim() : undefined,
      metadata: (record.metadata as Record<string, unknown> | undefined) ?? {}
    });
  }
  return tasks;
}

async function runBrowserAutomation(companyId?: string): Promise<Record<string, unknown>> {
  const tasks = parseBrowserAutomationTasks().filter((task) =>
    companyId ? task.companyId === companyId : true
  );
  let queued = 0;

  for (const task of tasks) {
    const result = await createOpsTaskIfNotRecent({
      companyId: task.companyId,
      type: "browser_automation",
      recipientEmail: task.recipientEmail ?? null,
      subject: task.label
        ? `FlowPay browser automation: ${task.label}`
        : "FlowPay browser automation task",
      payload: {
        companyId: task.companyId,
        url: task.url,
        instructions: task.instructions,
        metadata: task.metadata ?? {},
        generatedAt: new Date().toISOString()
      },
      dedupeWindowMinutes: dedupeWindowMinutes()
    });
    if (result.created) {
      queued += 1;
    }
  }

  return {
    configuredTasks: tasks.length,
    queued
  };
}

async function executeAutomationJob(
  job: Exclude<AutomationJobName, "all">,
  options: AutomationRunOptions
): Promise<Record<string, unknown>> {
  if (job === "finance") {
    return runFinanceAutomation(options.companyId);
  }
  if (job === "backend") {
    return runBackendWorkflowAutomation(options.companyId);
  }
  if (job === "blockchain") {
    return runBlockchainAutomation(options.companyId);
  }
  if (job === "monitoring") {
    return runMonitoringAutomation(options.companyId);
  }
  if (job === "support") {
    return runSupportAutomation(options.companyId);
  }
  return runBrowserAutomation(options.companyId);
}

async function runWithRecord(
  job: Exclude<AutomationJobName, "all">,
  options: AutomationRunOptions
): Promise<AutomationRunRecord> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let summary: Record<string, unknown> = {};

  try {
    summary = await executeAutomationJob(job, options);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : `Job ${job} failed`);
  }

  const record: AutomationRunRecord = {
    job,
    startedAt,
    finishedAt: new Date().toISOString(),
    success: errors.length === 0,
    summary,
    errors
  };
  runStatus.set(job, record);
  return record;
}

export async function runAutomationJob(
  job: AutomationJobName,
  options: AutomationRunOptions = {}
): Promise<AutomationRunRecord | Record<string, AutomationRunRecord>> {
  if (job === "all") {
    const records: Record<string, AutomationRunRecord> = {};
    for (const name of [
      "finance",
      "backend",
      "blockchain",
      "monitoring",
      "support",
      "browser"
    ] as const) {
      records[name] = await runWithRecord(name, options);
    }
    const allRecord: AutomationRunRecord = {
      job: "all",
      startedAt: records.finance.startedAt,
      finishedAt: new Date().toISOString(),
      success: Object.values(records).every((record) => record.success),
      summary: records,
      errors: Object.values(records).flatMap((record) => record.errors)
    };
    runStatus.set("all", allRecord);
    return records;
  }

  return runWithRecord(job, options);
}

export function getAutomationStatus() {
  const status: Record<string, AutomationRunRecord> = {};
  for (const [job, record] of runStatus.entries()) {
    status[job] = record;
  }
  return status;
}
