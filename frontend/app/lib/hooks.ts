"use client";

/**
 * FlowPay — React data hooks
 *
 * Each hook returns { data, loading, error, refetch }.
 * Company/employee context is pulled from localStorage via companyContext.ts.
 */

import { useEffect, useState, useCallback } from "react";
import {
  fetchCompany,
  fetchTreasuryBalance,
  fetchTreasuryAllocation,
  fetchEmployees,
  fetchEmployee,
  fetchEmployeeWallet,
  fetchLendingHistory,
  fetchMyLoans,
  fetchPayrollHistory,
  fetchTransactions,
  fetchMyTransactions,
  apiFetch,
  type Company,
  type Employee,
  type Loan,
  type EmployeeWallet,
  type LendingSummary,
  type Transaction,
  type PayrollHistoryEntry,
  type TreasuryBalance,
  type TreasuryAllocationSnapshot,
} from "./api";
import { loadCompanyContext, loadEmployeeContext } from "./companyContext";

function useClientContext<T>(loader: () => T | null) {
  const [ctx, setCtx] = useState<T | null>(null);
  useEffect(() => {
    setCtx(loader());
  }, []);
  return ctx;
}

// ── Generic fetcher hook ──────────────────────────────────────
function useApi<T>(
  fetcher: (() => Promise<T>) | null,
  options?: { refreshMs?: number; keepDataWhileRefreshing?: boolean }
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (background = false) => {
    if (!fetcher) { setLoading(false); return; }
    if (!background || !options?.keepDataWhileRefreshing) {
      setLoading(true);
    }
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (err: any) {
      setError(err?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [fetcher, options?.keepDataWhileRefreshing]);

  const refetch = useCallback(() => run(false), [run]);

  useEffect(() => { run(false); }, [run]);

  useEffect(() => {
    if (!fetcher || !options?.refreshMs) {
      return;
    }

    const interval = window.setInterval(() => {
      run(true);
    }, options.refreshMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [fetcher, options?.refreshMs, run]);

  return { data, loading, error, refetch };
}

// ── Company ──────────────────────────────────────────────────

export function useCompany() {
  const ctx = useClientContext(loadCompanyContext);
  const id = ctx?.id ?? null;
  const fetcher = useCallback(() => fetchCompany(id as string), [id]);
  return useApi<Company>(id ? fetcher : null);
}

// ── Treasury ─────────────────────────────────────────────────

export function useTreasuryBalance() {
  const ctx = useClientContext(loadCompanyContext);
  const id = ctx?.id ?? null;
  const fetcher = useCallback(() => fetchTreasuryBalance(id as string), [id]);
  return useApi<TreasuryBalance>(id ? fetcher : null);
}

export function useTreasuryAllocation() {
  const ctx = useClientContext(loadCompanyContext);
  const id = ctx?.id ?? null;
  const fetcher = useCallback(() => fetchTreasuryAllocation(id as string), [id]);
  return useApi<TreasuryAllocationSnapshot>(id ? fetcher : null);
}

// ── Employees ────────────────────────────────────────────────

export function useEmployees() {
  const ctx = useClientContext(loadCompanyContext);
  const id = ctx?.id ?? null;
  const fetcher = useCallback(() => fetchEmployees(id as string), [id]);
  return useApi<{ employees: Employee[] }>(id ? fetcher : null);
}

export function useEmployee(employeeId: string | null) {
  const fetcher = useCallback(() => fetchEmployee(employeeId as string), [employeeId]);
  return useApi<Employee>(employeeId ? fetcher : null);
}

export function useEmployeeWallet(employeeId: string | null) {
  const fetcher = useCallback(() => fetchEmployeeWallet(employeeId as string), [employeeId]);
  return useApi<EmployeeWallet>(employeeId ? fetcher : null);
}

// ── Lending ──────────────────────────────────────────────────

export function useLendingHistory() {
  const ctx = useClientContext(loadCompanyContext);
  const id = ctx?.id ?? null;
  const fetcher = useCallback(() => fetchLendingHistory(id as string), [id]);
  return useApi<{ summary: LendingSummary; loans: Loan[] }>(id ? fetcher : null);
}

export function useMyLoans() {
  const ctx = useClientContext(loadEmployeeContext);
  const id = ctx?.id ?? null;
  const fetcher = useCallback(() => fetchMyLoans(id as string), [id]);
  return useApi<{ loans: Loan[] }>(id ? fetcher : null);
}

// ── Payroll ──────────────────────────────────────────────────

export function usePayrollHistory() {
  const ctx = useClientContext(loadCompanyContext);
  const id = ctx?.id ?? null;
  const fetcher = useCallback(() => fetchPayrollHistory(id as string), [id]);
  return useApi<{ history: PayrollHistoryEntry[] }>(id ? fetcher : null);
}

// ── Transactions ─────────────────────────────────────────────

export function useTransactions(limit = 50, offset = 0) {
  const ctx = useClientContext(loadCompanyContext);
  const id = ctx?.id ?? null;
  const fetcher = useCallback(() => fetchTransactions(id as string, limit, offset), [id, limit, offset]);
  return useApi<{ transactions: Transaction[]; total: number }>(id ? fetcher : null);
}

export function useMyTransactions() {
  const ctx = useClientContext(loadEmployeeContext);
  const id = ctx?.id ?? null;
  const fetcher = useCallback(() => fetchMyTransactions(id as string), [id]);
  return useApi<{ transactions: Transaction[] }>(id ? fetcher : null);
}

// ── Investments ───────────────────────────────────────────────

export type InvestmentData = {
  allocation: {
    investment_pool: string;
    payroll_reserve: string;
    lending_pool: string;
    main_reserve: string;
    created_at: string;
  } | null;
  positions: {
    id: string;
    protocol: string;
    amount_deposited: string;
    atoken_balance: string;
    yield_earned: string;
    status: "active" | "closed" | "liquidated" | "sync_failed";
    opened_at: string;
    closed_at: string | null;
    tx_hash: string | null;
    entry_price: string | null;
  }[];
  transactions: {
    id: string;
    amount: string;
    token_symbol?: string;
    tx_hash: string | null;
    created_at: string;
  }[];
  summary: {
    total_invested: string;
    investment_pool: string;
    transaction_count: number;
  };
  execution_token_symbol?: string;
  market: {
    asset: string;
    price: number;
    change_pct: number;
    source: string;
  } | null;
  marketBoard: {
    updatedAt: string;
    pricingSource: string;
    rankingSource: "cmc" | "curated";
    crypto: {
      rank: number;
      name: string;
      symbol: string;
      category: "crypto" | "metal";
      price: number | null;
      changePct24h: number | null;
      source: string;
      available: boolean;
    }[];
    metals: {
      rank: number;
      name: string;
      symbol: string;
      category: "crypto" | "metal";
      price: number | null;
      changePct24h: number | null;
      source: string;
      available: boolean;
    }[];
  } | null;
  marketTop?: {
    rank: number;
    name: string;
    symbol: string;
    price: number;
    changePct24h: number;
    marketCap: number;
    volume24h: number;
  }[];
};

export function useInvestments() {
  const ctx = useClientContext(loadCompanyContext);
  const id = ctx?.id ?? null;
  const fetcher = useCallback(
    () => apiFetch<InvestmentData>(`/investments?companyId=${id}`),
    [id]
  );
  return useApi<InvestmentData>(id ? fetcher : null, {
    refreshMs: 30 * 1000,
    keepDataWhileRefreshing: true
  });
}
