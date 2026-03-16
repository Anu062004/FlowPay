import parser from "cron-parser";
import { db } from "../db/pool.js";
import { runTreasuryAllocationAgent } from "./treasuryAgent.js";
import { env } from "../config/env.js";
import { logAgentAction } from "../services/agentLogService.js";
import { withdrawFromAave } from "../services/aaveService.js";
import { getEthPrice } from "../services/priceService.js";
import { getTreasuryBalance } from "../services/treasuryService.js";
import { runInvestment } from "../services/investmentService.js";

type ActivePosition = {
  id: string;
  amount_deposited: string;
  entry_price: string | null;
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

async function withdrawFromPositions(companyId: string, amountEth: number): Promise<number> {
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
    await withdrawFromAave(companyId, toWithdraw);

    if (toWithdraw >= positionAmount) {
      await db.query(
        "UPDATE investment_positions SET status = 'closed', closed_at = now() WHERE id = $1",
        [position.id]
      );
    } else {
      await db.query(
        "UPDATE investment_positions SET amount_deposited = amount_deposited - $1 WHERE id = $2",
        [toWithdraw, position.id]
      );
    }

    withdrawn += toWithdraw;
    remaining -= toWithdraw;
  }

  return withdrawn;
}

async function withdrawAllPositions(companyId: string): Promise<number> {
  const positions = await getActivePositions(companyId);
  let total = 0;

  for (const position of positions) {
    const amount = parseFloat(position.amount_deposited);
    if (amount <= 0) {
      continue;
    }
    await withdrawFromAave(companyId, amount);
    await db.query(
      "UPDATE investment_positions SET status = 'closed', closed_at = now() WHERE id = $1",
      [position.id]
    );
    total += amount;
  }

  return total;
}

function getHoursToNextPayroll(): number {
  const interval = parser.parseExpression(env.PAYROLL_CRON);
  const nextPayroll = interval.next().toDate();
  const now = new Date();
  return (nextPayroll.getTime() - now.getTime()) / (1000 * 60 * 60);
}

export async function runOrchestrator() {
  const companies = await db.query("SELECT id FROM companies");
  const market = await getEthPrice();

  for (const company of companies.rows) {
    const companyId = company.id as string;

    try {
      const initialBalance = await getTreasuryBalance(companyId);
      let balanceEth = parseFloat(initialBalance.balance);
      const monthlyPayroll = await getMonthlyPayroll(companyId);

      // Check 1 — Payroll Shortfall Auto-Recovery
      if (balanceEth < monthlyPayroll * 1.5) {
        const needed = monthlyPayroll * 1.5 - balanceEth;
        const withdrawn = await withdrawFromPositions(companyId, needed);
        if (withdrawn > 0) {
          const refreshedBalance = await getTreasuryBalance(companyId);
          balanceEth = parseFloat(refreshedBalance.balance);
          await logAgentAction(
            "GUARDIAN",
            { balanceEth, monthlyPayroll },
            { action: "EMERGENCY_WITHDRAWAL", withdrawn_eth: withdrawn },
            `Treasury below 1.5x payroll threshold. Withdrew ${withdrawn.toFixed(6)} ETH from Aave.`,
            `EMERGENCY_WITHDRAWAL executed for ${withdrawn.toFixed(6)} ETH.`,
            companyId
          );
        }
      }

      // Check 2 — ETH Crash Position Exit
      const avgEntryPriceResult = await db.query(
        "SELECT AVG(entry_price) AS avg_entry_price FROM investment_positions WHERE company_id = $1 AND status = 'active' AND entry_price IS NOT NULL",
        [companyId]
      );
      const avgEntryPrice = parseFloat(avgEntryPriceResult.rows[0].avg_entry_price ?? "0");
      if (avgEntryPrice > 0 && market.price < avgEntryPrice * 0.8) {
        const withdrawn = await withdrawAllPositions(companyId);
        if (withdrawn > 0) {
          await logAgentAction(
            "GUARDIAN",
            { current_eth_price: market.price, avg_entry_price: avgEntryPrice },
            { action: "CRASH_EXIT", withdrawn_eth: withdrawn },
            "ETH dropped 20%+ since position entry. Exiting all Aave positions to protect capital.",
            `CRASH_EXIT executed for ${withdrawn.toFixed(6)} ETH.`,
            companyId
          );
        }
      }

      // Check 3 — Loan Default Cascade Protection
      const overdueResult = await db.query(
        "SELECT COUNT(*) AS overdue_count FROM loans l JOIN employees e ON l.employee_id = e.id WHERE e.company_id = $1 AND l.status = 'active' AND l.updated_at < now() - interval '30 days'",
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
          companyId
        );
      }

      // Check 4 — Pre-Payroll Coverage Guarantee
      const hoursToPayroll = getHoursToNextPayroll();
      if (hoursToPayroll <= 48 && balanceEth < monthlyPayroll) {
        const shortfall = monthlyPayroll - balanceEth;
        const withdrawn = await withdrawFromPositions(companyId, shortfall);

        if (withdrawn > 0) {
          const refreshedBalance = await getTreasuryBalance(companyId);
          balanceEth = parseFloat(refreshedBalance.balance);
          await logAgentAction(
            "GUARDIAN",
            { balanceEth, monthlyPayroll, hoursToPayroll },
            { action: "PAYROLL_COVERAGE_WITHDRAWAL", withdrawn_eth: withdrawn },
            `Payroll in 48h. Insufficient treasury. Withdrew ${withdrawn.toFixed(6)} ETH from Aave to guarantee coverage.`,
            `PAYROLL_COVERAGE_WITHDRAWAL executed for ${withdrawn.toFixed(6)} ETH.`,
            companyId
          );
        }

        if (balanceEth < monthlyPayroll) {
          await logAgentAction(
            "GUARDIAN",
            { finalBalance: balanceEth, monthlyPayroll, hoursToPayroll },
            { action: "CRITICAL_PAYROLL_SHORTFALL" },
            "CRITICAL: Payroll in 48h and treasury remains insufficient after Aave withdrawal. Do not run payroll.",
            "CRITICAL payroll coverage alert raised.",
            companyId
          );
          continue;
        }
      }

      const outstandingLoansResult = await db.query(
        "SELECT COALESCE(SUM(remaining_balance), 0) AS outstanding_loans FROM loans l JOIN employees e ON l.employee_id = e.id WHERE e.company_id = $1 AND l.status = 'active'",
        [companyId]
      );
      const outstandingLoans = parseFloat(outstandingLoansResult.rows[0].outstanding_loans);

      const treasuryInput = {
        balance: balanceEth,
        monthly_payroll: monthlyPayroll,
        outstanding_loans: outstandingLoans
      };
      const allocation = await runTreasuryAllocationAgent(treasuryInput);
      await logAgentAction(
        "TreasuryAllocationAgent",
        treasuryInput,
        allocation,
        allocation.rationale,
        `Allocated: ${(allocation.payroll_reserve_pct * 100).toFixed(1)}% Payroll, ${(allocation.lending_pool_pct * 100).toFixed(1)}% Lending, ${(allocation.investment_pool_pct * 100).toFixed(1)}% Investment`,
        companyId
      );

      const investmentDecision = await runInvestment(companyId);
      await logAgentAction(
        "InvestmentAgent",
        { companyId },
        investmentDecision,
        investmentDecision.rationale,
        investmentDecision.decision === "invest"
          ? `Investing ${(investmentDecision.allocation_pct * 100).toFixed(1)}% of investment pool`
          : investmentDecision.decision === "withdraw"
            ? "Withdrawing from Aave"
            : "Holding investment pool",
        companyId
      );
    } catch (error) {
      console.error(`Error in orchestrator loop for company ${companyId}:`, error);
    }
  }
}
