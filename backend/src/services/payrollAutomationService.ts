import { db } from "../db/pool.js";
import { env } from "../config/env.js";
import { getCompanySettings } from "./settingsService.js";
import { getDuePayrollEmployees, requestPayrollApproval, runPayroll } from "./payrollService.js";
import { getPayrollScheduleStatus } from "../utils/payrollSchedule.js";

function parseInteger(value: string, fallback: number) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function processAutomatedPayrollSchedules(referenceDate = new Date()) {
  const companies = await db.query(
    "SELECT id FROM companies WHERE treasury_wallet_id IS NOT NULL ORDER BY created_at ASC"
  );

  const runHourLocal = parseInteger(env.PAYROLL_AUTOMATION_LOCAL_HOUR, 9);
  const runMinuteLocal = parseInteger(env.PAYROLL_AUTOMATION_LOCAL_MINUTE, 0);
  const summary = {
    checked: companies.rowCount ?? 0,
    automated: 0,
    approvalsRequested: 0,
    skipped: 0,
    failed: 0,
    results: [] as Array<Record<string, unknown>>,
  };

  for (const company of companies.rows) {
    try {
      const settings = await getCompanySettings(company.id);
      const schedule = getPayrollScheduleStatus({
        payrollDayLabel: settings.payroll.payrollDay,
        companyTimeZone: settings.profile.timeZone,
        referenceDate,
        runHourLocal,
        runMinuteLocal,
      });

      if (schedule.schedule.mode === "manual" || !schedule.due) {
        summary.skipped += 1;
        summary.results.push({
          companyId: company.id,
          status: "skipped",
          reason: schedule.schedule.mode === "manual" ? "manual_schedule" : "before_schedule_time",
          payrollMonth: schedule.payrollMonthKey,
        });
        continue;
      }

      const dueEmployees = await getDuePayrollEmployees(company.id, schedule.payrollMonthKey);
      if (dueEmployees.length === 0) {
        summary.skipped += 1;
        summary.results.push({
          companyId: company.id,
          status: "skipped",
          reason: "no_due_employees",
          payrollMonth: schedule.payrollMonthKey,
        });
        continue;
      }

      if (!settings.payroll.autoProcess) {
        await requestPayrollApproval(company.id, {
          payrollMonthKey: schedule.payrollMonthKey,
          payrollMonthLabel: schedule.payrollMonthLabel,
        });
        summary.approvalsRequested += 1;
        summary.results.push({
          companyId: company.id,
          status: "approval_requested",
          dueEmployees: dueEmployees.length,
          payrollMonth: schedule.payrollMonthKey,
        });
        continue;
      }

      const result = await runPayroll(
        company.id,
        {
          source: "payroll_scheduler",
          workflowName: "automated_payroll",
          stage: "scheduler_trigger",
        },
        {
          payrollMonthKey: schedule.payrollMonthKey,
          payrollMonthLabel: schedule.payrollMonthLabel,
          emiAutoDeduction: settings.payroll.emiAutoDeduction,
        }
      );

      summary.automated += 1;
      summary.results.push({
        companyId: company.id,
        status: "processed",
        processedEmployees: result.companySummaries[0]?.processedEmployees ?? 0,
        payrollMonth: schedule.payrollMonthKey,
      });
    } catch (error) {
      summary.failed += 1;
      summary.results.push({
        companyId: company.id,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown payroll scheduler error",
      });
      console.error("[PayrollScheduler] Automated payroll execution failed", {
        companyId: company.id,
        error,
      });
    }
  }

  return summary;
}
