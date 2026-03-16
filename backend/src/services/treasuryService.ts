import { formatEther } from "ethers";
import { db } from "../db/pool.js";
import { env } from "../config/env.js";
import { runTreasuryAllocationAgent } from "../agents/treasuryAgent.js";
import { ApiError } from "../utils/errors.js";
import { getWalletBalance } from "./walletService.js";
import { allocateVault } from "./contractService.js";

export async function getTreasuryBalance(companyId: string) {
  const result = await db.query(
    "SELECT w.id as wallet_id FROM companies c JOIN wallets w ON c.treasury_wallet_id = w.id WHERE c.id = $1",
    [companyId]
  );
  if (result.rowCount === 0) {
    throw new ApiError(404, "Company treasury wallet not found");
  }
  const balance = await getWalletBalance(result.rows[0].wallet_id);
  return {
    ...balance,
    balance: balance.balanceEth,
    wallet_address: balance.walletAddress
  };
}

export async function allocateTreasury(companyId: string, balanceWei: bigint) {
  const balanceEth = parseFloat(formatEther(balanceWei));
  const payrollResult = await db.query(
    "SELECT COALESCE(SUM(salary), 0) as total_salary FROM employees WHERE company_id = $1",
    [companyId]
  );
  const loanResult = await db.query(
    "SELECT COALESCE(SUM(remaining_balance), 0) as outstanding_loans FROM loans l JOIN employees e ON l.employee_id = e.id WHERE e.company_id = $1 AND l.status = 'active'",
    [companyId]
  );

  const context = {
    balance: balanceEth,
    monthly_payroll: parseFloat(payrollResult.rows[0].total_salary),
    outstanding_loans: parseFloat(loanResult.rows[0].outstanding_loans)
  };

  const allocation = await runTreasuryAllocationAgent(context).catch(() => null);
  const payrollPct = allocation?.payroll_reserve_pct ?? parseFloat(env.TREASURY_PAYROLL_RESERVE_PCT);
  const lendingPct = allocation?.lending_pool_pct ?? parseFloat(env.TREASURY_LENDING_PCT);
  const investmentPct = allocation?.investment_pool_pct ?? parseFloat(env.TREASURY_INVESTMENT_PCT);

  if (Math.abs(payrollPct + lendingPct + investmentPct - 1) > 0.01) {
    throw new ApiError(400, "Invalid treasury allocation percentages");
  }

  const payrollReserve = balanceEth * payrollPct;
  const lendingPool = balanceEth * lendingPct;
  const investmentPool = balanceEth * investmentPct;

  // 1. DB Commit
  await db.query(
    "INSERT INTO treasury_allocations (company_id, payroll_reserve, lending_pool, investment_pool) VALUES ($1, $2, $3, $4)",
    [companyId, payrollReserve.toFixed(6), lendingPool.toFixed(6), investmentPool.toFixed(6)]
  );

  // 2. Sync to contract - AWAIT THIS to ensure chain success
  try {
    await allocateVault(payrollPct, lendingPct, investmentPct);
  } catch (error) {
    console.error(`[Blockchain] Failed to sync treasury allocation for company ${companyId}:`, error);
    // In a critical fintech app, we might want to throw here to fail the whole request
    // throw new ApiError(500, "Failed to sync allocation to blockchain");
  }

  return {
    payroll_reserve: payrollReserve,
    lending_pool: lendingPool,
    investment_pool: investmentPool
  };
}
