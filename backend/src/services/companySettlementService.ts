import { db } from "../db/pool.js";
import { ApiError } from "../utils/errors.js";
import {
  SettlementChain,
  getDefaultSettlementChain,
  normalizeSettlementChain
} from "../utils/settlement.js";
import { startDepositWatcher, stopDepositWatcher } from "./depositWatcher.js";

type SettlementChangeState = {
  chain: SettlementChain;
  switchAllowed: boolean;
  switchBlockedReason: string | null;
};

export async function getCompanySettlementChain(companyId: string): Promise<SettlementChain> {
  const result = await db.query(
    `SELECT
       COALESCE(company_settings.payroll ->> 'currency', '') AS payroll_currency,
       treasury_wallet.chain AS treasury_chain
     FROM companies c
     LEFT JOIN company_settings ON company_settings.company_id = c.id
     LEFT JOIN wallets treasury_wallet ON treasury_wallet.id = c.treasury_wallet_id
     WHERE c.id = $1`,
    [companyId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Company not found");
  }

  const payrollCurrency = (result.rows[0]?.payroll_currency as string | undefined)?.trim().toLowerCase();
  if (payrollCurrency?.includes("polygon")) {
    return "polygon";
  }
  if (payrollCurrency?.includes("ethereum")) {
    return "ethereum";
  }

  return normalizeSettlementChain(result.rows[0]?.treasury_chain as string | undefined, getDefaultSettlementChain());
}

async function getCompanySettlementChangeState(companyId: string): Promise<SettlementChangeState> {
  const chain = await getCompanySettlementChain(companyId);
  const activityResult = await db.query(
    `SELECT
       EXISTS(
         SELECT 1
         FROM transactions t
         JOIN wallets w ON w.id = t.wallet_id
         WHERE w.owner_type = 'company'
           AND w.owner_id = $1
       ) AS has_company_transactions,
       EXISTS(SELECT 1 FROM employees e WHERE e.company_id = $1) AS has_employees,
       EXISTS(
         SELECT 1
         FROM loans l
         JOIN employees e ON e.id = l.employee_id
         WHERE e.company_id = $1
       ) AS has_loans,
       EXISTS(SELECT 1 FROM payroll_disbursements pd WHERE pd.company_id = $1) AS has_payroll
    `,
    [companyId]
  );

  const state = activityResult.rows[0] as {
    has_company_transactions: boolean;
    has_employees: boolean;
    has_loans: boolean;
    has_payroll: boolean;
  };

  const hasActivity =
    state.has_company_transactions || state.has_employees || state.has_loans || state.has_payroll;

  return {
    chain,
    switchAllowed: !hasActivity,
    switchBlockedReason: hasActivity
      ? "Network can only be changed before treasury activity, employees, payroll, or loans exist."
      : null
  };
}

export async function assertCompanySettlementChainCanChange(
  companyId: string,
  nextChain: SettlementChain
) {
  const state = await getCompanySettlementChangeState(companyId);
  if (state.chain === nextChain) {
    return state;
  }
  if (!state.switchAllowed) {
    throw new ApiError(409, state.switchBlockedReason ?? "Company settlement network cannot be changed now");
  }
  return state;
}

export async function applyCompanySettlementChain(companyId: string, nextChain: SettlementChain) {
  const state = await assertCompanySettlementChainCanChange(companyId, nextChain);
  if (state.chain === nextChain) {
    return state;
  }

  const walletResult = await db.query(
    `SELECT id, wallet_address
     FROM wallets
     WHERE id IN (
       SELECT c.treasury_wallet_id
       FROM companies c
       WHERE c.id = $1
     )`,
    [companyId]
  );

  await db.query(
    `UPDATE wallets
     SET chain = $2
     WHERE owner_type = 'company'
       AND owner_id = $1`,
    [companyId, nextChain]
  );
  await db.query(
    `UPDATE wallets
     SET chain = $2
     WHERE owner_type = 'employee'
       AND owner_id IN (
         SELECT e.id
         FROM employees e
         WHERE e.company_id = $1
       )`,
    [companyId, nextChain]
  );

  const treasuryWallet = walletResult.rows[0] as { id: string; wallet_address: string } | undefined;
  if (treasuryWallet) {
    await stopDepositWatcher(treasuryWallet.id);
    await startDepositWatcher(treasuryWallet.id, companyId, treasuryWallet.wallet_address, {
      force: true
    });
  }

  return {
    chain: nextChain,
    switchAllowed: true,
    switchBlockedReason: null
  } satisfies SettlementChangeState;
}

export async function getCompanySettlementSummary(companyId: string) {
  const state = await getCompanySettlementChangeState(companyId);
  return {
    chain: state.chain,
    switchAllowed: state.switchAllowed,
    switchBlockedReason: state.switchBlockedReason
  };
}
