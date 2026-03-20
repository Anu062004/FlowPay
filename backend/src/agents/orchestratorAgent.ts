import { randomUUID } from "crypto";
import { CronExpressionParser } from "cron-parser";
import { db } from "../db/pool.js";
import { env } from "../config/env.js";
import { logAgentAction, type AgentLogContext } from "../services/agentLogService.js";
import { withdrawFromAave } from "../services/aaveService.js";
import { getEthPrice } from "../services/priceService.js";
import { allocateTreasury, getTreasuryBalance } from "../services/treasuryService.js";
import { runInvestment } from "../services/investmentService.js";
import { createOpsTask } from "../services/opsService.js";

type ActivePosition = {
  id: string;
  amount_deposited: string;
  entry_price: string | null;
};

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

async function getActivePositions(companyId: string): Promise<ActivePosition[]> {
  const result = await db.query(
    "SELECT id, amount_deposited, entry_price FROM investment_positions WHERE company_id = $1 AND status = 'active' ORDER BY opened_at ASC",
    [companyId]
  );
  return result.rows as ActivePosition[];
}

async function withdrawFromPositions(
  companyId: string,
  amountEth: number,
  auditContext: AgentLogContext = {}
): Promise<number> {
  if (amountEth <= 0) {
    return 0;
  }

  const positions = await getActivePositions(companyId);
  let remaining = amountEth;
  let withdrawn = 0;

  for (const position of positions) {
    if (remaining <= 0) {
      break;
    }

    const positionAmount = parseFloat(position.amount_deposited);
    if (positionAmount <= 0) {
      continue;
    }

    const toWithdraw = Math.min(positionAmount, remaining);
    try {
      const txHash = await withdrawFromAave(companyId, toWithdraw);
      await db.query(
        "UPDATE investment_positions SET status = 'closed', closed_at = now() WHERE id = $1",
        [position.id]
      );
      await logAgentAction(
        "GUARDIAN",
        { companyId, positionId: position.id, amount: toWithdraw, txHash },
        { action: "WITHDRAWAL_SUCCESS" },
        `Successfully withdrew ${toWithdraw.toFixed(6)} ETH for position ${position.id}.`,
        "WITHDRAWAL_SUCCESS",
        companyId,
        {
          ...auditContext,
          stage: "wdk_execution",
          executionStatus: "success"
        }
      );
      withdrawn += toWithdraw;
      remaining -= toWithdraw;
    } catch (error) {
      await db.query(
        "UPDATE investment_positions SET status = 'sync_failed' WHERE id = $1",
        [position.id]
      );
      const errorMessage = error instanceof Error ? error.message : "Unknown withdrawal error";
      await logAgentAction(
        "GUARDIAN",
        { companyId, positionId: position.id, amount: toWithdraw },
        { action: "WITHDRAWAL_FAILED" },
        errorMessage,
        "WITHDRAWAL_FAILED",
        companyId,
        {
          ...auditContext,
          stage: "wdk_execution",
          executionStatus: "failed"
        }
      );
    }
  }

  return withdrawn;
}

async function withdrawAllPositions(
  companyId: string,
  auditContext: AgentLogContext = {}
): Promise<number> {
  const positions = await getActivePositions(companyId);
  let total = 0;

  for (const position of positions) {
    const amount = parseFloat(position.amount_deposited);
    if (amount <= 0) {
      continue;
    }

    try {
      const txHash = await withdrawFromAave(companyId, amount);
      await db.query(
        "UPDATE investment_positions SET status = 'closed', closed_at = now() WHERE id = $1",
        [position.id]
      );
      await logAgentAction(
        "GUARDIAN",
        { companyId, positionId: position.id, amount, txHash },
        { action: "WITHDRAWAL_SUCCESS" },
        `Successfully withdrew ${amount.toFixed(6)} ETH for position ${position.id}.`,
        "WITHDRAWAL_SUCCESS",
        companyId,
        {
          ...auditContext,
          stage: "wdk_execution",
          executionStatus: "success"
        }
      );
      total += amount;
    } catch (error) {
      await db.query(
        "UPDATE investment_positions SET status = 'sync_failed' WHERE id = $1",
        [position.id]
      );
      const errorMessage = error instanceof Error ? error.message : "Unknown withdrawal error";
      await logAgentAction(
        "GUARDIAN",
        { companyId, positionId: position.id, amount },
        { action: "WITHDRAWAL_FAILED" },
        errorMessage,
        "WITHDRAWAL_FAILED",
        companyId,
        {
          ...auditContext,
          stage: "wdk_execution",
          executionStatus: "failed"
        }
      );
    }
  }

  return total;
}

function getHoursToNextPayroll(): number {
  const interval = CronExpressionParser.parse(env.PAYROLL_CRON);
  const nextPayroll = interval.next().toDate();
  const now = new Date();
  return (nextPayroll.getTime() - now.getTime()) / (1000 * 60 * 60);
}

export async function runOrchestrator(options: OrchestratorRunOptions = {}) {
  const companies = options.companyId
    ? await db.query("SELECT id FROM companies WHERE id = $1", [options.companyId])
    : await db.query("SELECT id FROM companies");
  const market = await getEthPrice();
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
        { companyId, market },
        { mode: "strategy" },
        "Evaluating treasury, payroll coverage, lending guardrails, and Aave posture.",
        "Strategy loop started.",
        companyId,
        {
          ...auditContext,
          stage: "workflow",
          executionStatus: "started"
        }
      );

      const initialBalance = await getTreasuryBalance(companyId);
      let balanceEth = parseFloat(initialBalance.balance);
      const monthlyPayroll = await getMonthlyPayroll(companyId);

      if (balanceEth < monthlyPayroll * 1.5) {
        const needed = monthlyPayroll * 1.5 - balanceEth;
        const withdrawn = await withdrawFromPositions(companyId, needed, auditContext);
        if (withdrawn > 0) {
          const refreshedBalance = await getTreasuryBalance(companyId);
          balanceEth = parseFloat(refreshedBalance.balance);
          await logAgentAction(
            "GUARDIAN",
            { balanceEth, monthlyPayroll },
            { action: "EMERGENCY_WITHDRAWAL", withdrawn_eth: withdrawn },
            `Treasury below 1.5x payroll threshold. Withdrew ${withdrawn.toFixed(6)} ETH from Aave.`,
            `EMERGENCY_WITHDRAWAL executed for ${withdrawn.toFixed(6)} ETH.`,
            companyId,
            {
              ...auditContext,
              stage: "guardrail",
              executionStatus: "success"
            }
          );
        }
      }

      const avgEntryPriceResult = await db.query(
        "SELECT AVG(entry_price) AS avg_entry_price FROM investment_positions WHERE company_id = $1 AND status = 'active' AND entry_price IS NOT NULL",
        [companyId]
      );
      const avgEntryPrice = parseFloat(avgEntryPriceResult.rows[0].avg_entry_price ?? "0");
      if (avgEntryPrice > 0 && market.price < avgEntryPrice * 0.8) {
        const withdrawn = await withdrawAllPositions(companyId, auditContext);
        if (withdrawn > 0) {
          await logAgentAction(
            "GUARDIAN",
            { current_eth_price: market.price, avg_entry_price: avgEntryPrice },
            { action: "CRASH_EXIT", withdrawn_eth: withdrawn },
            "ETH dropped 20%+ since position entry. Exiting all Aave positions to protect capital.",
            `CRASH_EXIT executed for ${withdrawn.toFixed(6)} ETH.`,
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

      const hoursToPayroll = getHoursToNextPayroll();
      if (hoursToPayroll <= 48 && balanceEth < monthlyPayroll) {
        const shortfall = monthlyPayroll - balanceEth;
        const withdrawn = await withdrawFromPositions(companyId, shortfall, auditContext);

        if (withdrawn > 0) {
          const refreshedBalance = await getTreasuryBalance(companyId);
          balanceEth = parseFloat(refreshedBalance.balance);
          await logAgentAction(
            "GUARDIAN",
            { balanceEth, monthlyPayroll, hoursToPayroll },
            { action: "PAYROLL_COVERAGE_WITHDRAWAL", withdrawn_eth: withdrawn },
            `Payroll in 48h. Insufficient treasury. Withdrew ${withdrawn.toFixed(6)} ETH from Aave to guarantee coverage.`,
            `PAYROLL_COVERAGE_WITHDRAWAL executed for ${withdrawn.toFixed(6)} ETH.`,
            companyId,
            {
              ...auditContext,
              stage: "guardrail",
              executionStatus: "success"
            }
          );
        }

        if (balanceEth < monthlyPayroll) {
          await logAgentAction(
            "GUARDIAN",
            { finalBalance: balanceEth, monthlyPayroll, hoursToPayroll },
            { action: "CRITICAL_PAYROLL_SHORTFALL" },
            "Critical payroll shortfall remains after Aave withdrawal.",
            "Critical payroll coverage alert raised.",
            companyId,
            {
              ...auditContext,
              stage: "guardrail",
              executionStatus: "blocked"
            }
          );
          const shortfall = Math.max(monthlyPayroll - balanceEth, 0);
          try {
            await createOpsTask({
              companyId,
              type: "treasury_topup",
              subject: "FlowPay treasury top-up required",
              payload: {
                companyId,
                shortfall,
                monthlyPayroll,
                balanceEth,
                hoursToPayroll,
                treasuryAddress: initialBalance.wallet_address,
                tokenSymbol: initialBalance.token_symbol ?? "ETH",
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
        { companyId, market, allocation, investmentDecision },
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
        { companyId, market },
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
