"use client";

// ── Company context (stored in localStorage) ─────────────────

export type CompanyContext = {
  id: string;
  name?: string;
  email?: string;
  treasuryAddress?: string | null;
};

const COMPANY_KEY = "flowpay_company";

export function loadCompanyContext(): CompanyContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COMPANY_KEY);
    return raw ? (JSON.parse(raw) as CompanyContext) : null;
  } catch {
    return null;
  }
}

export function saveCompanyContext(context: CompanyContext) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COMPANY_KEY, JSON.stringify(context));
}

export function clearCompanyContext() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(COMPANY_KEY);
}

// ── Employee context (stored in localStorage) ────────────────

export type EmployeeContext = {
  id: string;
  fullName?: string;
  companyId?: string;
  companyName?: string;
  walletAddress?: string | null;
};

const EMPLOYEE_KEY = "flowpay_employee";

export function loadEmployeeContext(): EmployeeContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(EMPLOYEE_KEY);
    return raw ? (JSON.parse(raw) as EmployeeContext) : null;
  } catch {
    return null;
  }
}

export function saveEmployeeContext(context: EmployeeContext) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EMPLOYEE_KEY, JSON.stringify(context));
}

export function clearEmployeeContext() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(EMPLOYEE_KEY);
}
