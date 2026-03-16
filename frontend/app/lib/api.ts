/**
 * FlowPay — Typed API Client
 *
 * All calls go through `apiFetch` which reads NEXT_PUBLIC_API_BASE_URL
 * (defaults to http://localhost:4000 for local dev).
 */

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `API error ${res.status}`);
  return data as T;
}

// ── Types ────────────────────────────────────────────────────

export type Company = {
  id: string;
  name: string;
  treasury_address: string | null;
  created_at: string;
};

export type Employee = {
  id: string;
  full_name: string;
  email: string;
  salary: string;          // NUMERIC from DB → string
  credit_score: number;
  status: string;
  created_at: string;
  wallet_address: string | null;
  active_loans: string;    // COUNT → string
  outstanding_balance: string;
  loan_status: string | null;
  company_id?: string;
  company_name?: string;
};

export type Loan = {
  id: string;
  employee_id?: string;
  full_name?: string;      // from lending/history JOIN
  amount: string;
  interest_rate: string;
  duration_months: number;
  remaining_balance: string;
  status: "pending" | "active" | "repaid" | "rejected";
  contract_synced: boolean;
  created_at: string;
  updated_at: string;
  emi?: number;
  months_paid?: number;
};

export type LendingSummary = {
  active_loans: string;
  total_loans: string;
  total_issued: string;
  remaining_balance: string;
};

export type Transaction = {
  id: string;
  type: "deposit" | "payroll" | "loan_disbursement" | "emi_repayment" | "investment" | "treasury_allocation";
  amount: string;
  tx_hash: string | null;
  created_at: string;
  wallet_address?: string;
};

export type TreasuryBalance = {
  balance: string;          // from walletService
  wallet_address?: string;
};

export type PayrollHistoryEntry = {
  id: string;
  amount: string;
  created_at: string;
  tx_hash: string | null;
  employee_count: string;
};

export type CompanySettings = {
  profile: {
    companyName: string;
    legalEntity: string;
    companyEmail: string;
    timeZone: string;
  };
  payroll: {
    payrollDay: string;
    currency: string;
    autoProcess: boolean;
    emiAutoDeduction: boolean;
    emailNotifications: boolean;
  };
  security: {
    twoFactor: boolean;
    transactionApproval: boolean;
    ipAllowlist: boolean;
    auditLog: boolean;
    sessionTimeout: string;
  };
  agent: {
    enabled: boolean;
    slippageProtection: boolean;
    maxTradeSize: number;
    riskTolerance: string;
    rebalanceFrequency: string;
  };
  updated_at?: string;
};

// ── Company ──────────────────────────────────────────────────

export const fetchCompany = (id: string) =>
  apiFetch<Company>(`/companies/${id}`);

export const fetchCompanies = () =>
  apiFetch<{ companies: Company[] }>("/companies");

export const registerCompany = (name: string) =>
  apiFetch<{ id: string; name: string }>("/companies/register", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

// ── Treasury ─────────────────────────────────────────────────

export const fetchTreasuryBalance = (companyId: string) =>
  apiFetch<TreasuryBalance>(`/treasury/balance?companyId=${companyId}`);

// ── Employees ────────────────────────────────────────────────

export const fetchEmployees = (companyId: string) =>
  apiFetch<{ employees: Employee[] }>(`/employees?companyId=${companyId}`);

export const fetchEmployee = (id: string) =>
  apiFetch<Employee>(`/employees/${id}`);

export const addEmployee = (body: {
  companyId: string;
  fullName: string;
  email: string;
  salary: number;
  creditScore?: number;
}) =>
  apiFetch<{ employee: Employee }>("/employees/add", {
    method: "POST",
    body: JSON.stringify(body),
  });

// ── Lending / Loans ──────────────────────────────────────────

export const fetchLendingHistory = (companyId: string) =>
  apiFetch<{ summary: LendingSummary; loans: Loan[] }>(
    `/lending/history?companyId=${companyId}`
  );

export const fetchMyLoans = (employeeId: string) =>
  apiFetch<{ loans: Loan[] }>(`/lending/me/${employeeId}`);

export const requestLoan = (employeeId: string, requestedAmount: number) =>
  apiFetch<{ decision: string; loanId?: string; amount?: number; emi?: number }>(
    "/loans/request",
    { method: "POST", body: JSON.stringify({ employeeId, requestedAmount }) }
  );

// ── Payroll ──────────────────────────────────────────────────

export const fetchPayrollHistory = (companyId: string) =>
  apiFetch<{ history: PayrollHistoryEntry[] }>(
    `/payroll/history?companyId=${companyId}`
  );

export const runPayroll = (companyId?: string) =>
  apiFetch<{ processed: number }>("/payroll/run", {
    method: "POST",
    body: JSON.stringify(companyId ? { companyId } : {}),
  });

// ── Transactions ─────────────────────────────────────────────

export const fetchTransactions = (
  companyId: string,
  limit = 50,
  offset = 0
) =>
  apiFetch<{ transactions: Transaction[]; total: number }>(
    `/transactions?companyId=${companyId}&limit=${limit}&offset=${offset}`
  );

export const fetchMyTransactions = (employeeId: string) =>
  apiFetch<{ transactions: Transaction[] }>(`/transactions/me/${employeeId}`);

// â”€â”€ Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const fetchCompanySettings = (companyId: string) =>
  apiFetch<{ settings: CompanySettings }>(`/settings?companyId=${companyId}`);

export const updateCompanySettings = (companyId: string, settings: CompanySettings) =>
  apiFetch<{ settings: CompanySettings }>(`/settings?companyId=${companyId}`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });

// ── Agents ───────────────────────────────────────────────────

export type AgentLog = {
  id: string;
  timestamp: string;
  agent_name: string;
  decision: any;
  rationale: string;
  action_taken: string;
  company_id: string | null;
};

export const fetchAgentLogs = (companyId?: string) => {
  const path = companyId ? `/agents/logs?companyId=${companyId}` : "/agents/logs";
  return apiFetch<{ logs: AgentLog[] }>(path, {
    headers: {
      "X-Master-Key": process.env.NEXT_PUBLIC_MASTER_KEY ?? "replace-with-strong-32-char-secret"
    }
  });
};
