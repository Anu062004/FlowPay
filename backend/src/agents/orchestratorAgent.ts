import { randomUUID } from "crypto";
import { db } from "../db/pool.js";
import { env } from "../config/env.js";
import { logAgentAction, type AgentLogContext } from "../services/agentLogService.js";
import { closeActiveInvestmentPositions } from "../services/investmentExecutionService.js";
import { allocateTreasury, getTreasuryBalance } from "../services/treasuryService.js";
import { runInvestment } from "../services/investmentService.js";
import { createOpsTask } from "../services/opsService.js";
import { getCompanySettings } from "../services/settingsService.js";
import { getNextPayrollRun } from "../utils/payrollSchedule.js";

type OrchestratorRunOptions = {
  companyId?: string;
  source?: string;
  workflowId?: string;
  workflowName?: string;
};

async function getMonthlyPayroll(companyId: string): Promise<number> {
  const result = await db.query(
    "SELECT COALESCE(SUM(salary), 0) AS monthly_payroll FROM employees WHERE company_id = $1 AND status = 'active'",
    [companyId]
  );
  return parseFloat(result.rows[0].monthly_payroll);
}

async function unwindInvestmentPositions(
  companyId: string,
  auditContext: AgentLogContext = {}
): Promise<number> {
  const positions = await closeActiveInvestmentPositions(companyId);
  let total = 0;

  for (const position of positions) {
    total += position.amount;
    await logAgentAction(
      "GUARDIAN",
      {
        companyId,
        protocol: position.protocolKey,
        amount: position.amount,
        txHash: position.txHash
      },
      { action: "WITHDRAWAL_SUCCESS" },
      `Closed ${position.protocolKey} position for ${position.amount.toFixed(6)} ${position.assetSymbol}.`,
      "WITHDRAWAL_SUCCESS",
      companyId,
      {
        ...auditContext,
        stage: "wdk_execution",
        executionStatus: "success"
      }
    );
  }

  return total;
}

export async function runOrchestrator(options: OrchestratorRunOptions = {}) {
  const companies = options.companyId
    ? await db.query("SELECT id FROM companies WHERE id = $1", [options.companyId])
    : await db.query("SELECT id FROM companies");
  const results: Array<{ companyId: string; workflowId: string; status: string }> = [];

  for (const company of companies.rows) {
    const companyId = company.id as string;
    const workflowId = options.workflowId ?? randomUUID();
    const auditContext: AgentLogContext = {
      workflowId,
      workflowName: options.workflowName ?? "strategy_orchestration",
      source: options.source ?? "backend_scheduler"
    };

    try {
      await logAgentAction(
        "OpenClawOrchestrator",
        { companyId },
        { mode: "strategy" },
        "Evaluating treasury, payroll coverage, lending guardrails, and TradingAgents investment posture.",
        "Strategy loop started.",
        companyId,
        {
          ...auditContext,
          stage: "workflow",
          executionStatus: "started"
        }
      );

      const initialBalance = await getTreasuryBalance(companyId);
      let balance = parseFloat(initialBalance.balance);
      const monthlyPayroll = await getMonthlyPayroll(companyId);
      const settings = await getCompanySettings(companyId);
      const nextPayroll = getNextPayrollRun({
        payrollDayLabel: settings.payroll.payrollDay,
        companyTimeZone: settings.profile.timeZone
      });

      if (balance < monthlyPayroll * 1.5) {
        const withdrawn = await unwindInvestmentPositions(companyId, auditContext);
        if (withdrawn > 0) {
          const refreshedBalance = await getTreasuryBalance(companyId);
          balance = parseFloat(refreshedBalance.balance);
          await logAgentAction(
            "GUARDIAN",
            { balance, monthlyPayroll },
            { action: "EMERGENCY_WITHDRAWAL", withdrawn_amount: withdrawn },
            `Treasury below 1.5x payroll threshold. Closed active investment positions worth ${withdrawn.toFixed(6)} units.`,
            `EMERGENCY_WITHDRAWAL executed for ${withdrawn.toFixed(6)} treasury units.`,
            companyId,
            {
              ...auditContext,
              stage: "guardrail",
              executionStatus: "success"
            }
          );
        }
      }

      const overdueResult = await db.query(
        "SELECT COUNT(*) AS overdue_count FROM loans JOIN employees e ON loans.employee_id = e.id WHERE e.company_id = $1 AND loans.status = 'active' AND loans.remaining_balance > 0 AND loans.created_at < now() - (loans.duration_months * interval '1 month')",
        [companyId]
      );
      const overdueCount = parseInt(overdueResult.rows[0].overdue_count, 10);
      if (overdueCount >= 2) {
        await db.query(
          "UPDATE company_settings SET agent = jsonb_set(COALESCE(agent, '{}'::jsonb), '{lending_paused}', 'true'::jsonb), updated_at = now() WHERE company_id = $1",
          [companyId]
        );
        await logAgentAction(
          "GUARDIAN",
          { overdueCount },
          { action: "PAUSE_LENDING", lending_paused: true },
          `${overdueCount} overdue loans detected. Lending paused. Review required.`,
          `Lending paused after overdue cascade detection (${overdueCount}).`,
          companyId,
          {
            ...auditContext,
            stage: "guardrail",
            executionStatus: "success"
          }
        );
      }

      const hoursToPayroll = nextPayroll?.hoursUntilRun ?? Number.POSITIVE_INFINITY;
      if (nextPayroll && hoursToPayroll <= 48 && balance < monthlyPayroll) {
        const withdrawn = await unwindInvestmentPositions(companyId, auditContext);

        if (withdrawn > 0) {
          const refreshedBalance = await getTreasuryBalance(companyId);
          balance = parseFloat(refreshedBalance.balance);
          await logAgentAction(
            "GUARDIAN",
            { balance, monthlyPayroll, hoursToPayroll },
            { action: "PAYROLL_COVERAGE_WITHDRAWAL", withdrawn_amount: withdrawn },
            `Payroll in 48h. Insufficient treasury. Closed active investment positions worth ${withdrawn.toFixed(6)} units.`,
            `PAYROLL_COVERAGE_WITHDRAWAL executed for ${withdrawn.toFixed(6)} treasury units.`,
            companyId,
            {
              ...auditContext,
              stage: "guardrail",
              executionStatus: "success"
            }
          );
        }

        if (balance < monthlyPayroll) {
          await logAgentAction(
            "GUARDIAN",
            { finalBalance: balance, monthlyPayroll, hoursToPayroll },
            { action: "CRITICAL_PAYROLL_SHORTFALL" },
            "Critical payroll shortfall remains after unwinding active investments.",
            "Critical payroll coverage alert raised.",
            companyId,
            {
              ...auditContext,
              stage: "guardrail",
              executionStatus: "blocked"
            }
          );
          const shortfall = Math.max(monthlyPayroll - balance, 0);
          try {
            await createOpsTask({
              companyId,
              type: "treasury_topup",
              subject: "FlowPay treasury top-up required",
              payload: {
                companyId,
                shortfall,
                monthlyPayroll,
                balance,
                hoursToPayroll,
                treasuryAddress: initialBalance.wallet_address,
                tokenSymbol: initialBalance.token_symbol ?? env.TREASURY_TOKEN_SYMBOL ?? "USDT",
                requestedAt: new Date().toISOString()
              }
            });
          } catch (error) {
            console.error("Failed to create treasury top-up task", error);
          }
          results.push({ companyId, workflowId, status: "shortfall" });
          continue;
        }
      }

      const refreshedBalance = await getTreasuryBalance(companyId);
      const allocation = await allocateTreasury(companyId, BigInt(refreshedBalance.balanceWei), auditContext);
      const investmentDecision = await runInvestment(companyId, auditContext);

      await logAgentAction(
        "OpenClawOrchestrator",
        { companyId, allocation, investmentDecision },
        { mode: "strategy" },
        "Strategy loop completed successfully.",
        "Strategy loop completed.",
        companyId,
        {
          ...auditContext,
          stage: "workflow",
          executionStatus: "success"
        }
      );
      results.push({ companyId, workflowId, status: "success" });
    } catch (error) {
      console.error(`Error in orchestrator loop for company ${companyId}:`, error);
      await logAgentAction(
        "OpenClawOrchestrator",
        { companyId },
        { mode: "strategy" },
        error instanceof Error ? error.message : "Strategy loop failed.",
        "Strategy loop failed.",
        companyId,
        {
          ...auditContext,
          stage: "workflow",
          executionStatus: "failed"
        }
      );
      results.push({ companyId, workflowId, status: "failed" });
    }
  }

  return {
    processed: results.length,
    results
  };
}
