/**
 * FlowPay — Typed API Client
 *
 * All calls go through `apiFetch` which reads NEXT_PUBLIC_API_BASE_URL
 * (defaults to http://localhost:4000 for local dev).
 */

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export class ApiFetchError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiFetchError";
    this.status = status;
    this.details = details;
  }
}

function clearStoredContexts() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem("flowpay_company");
  window.localStorage.removeItem("flowpay_employee");
}

async function sessionFetch<T>(path: string): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  if (res.status === 401 || res.status === 403) {
    return null;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? `API error ${res.status}`);
  }
  return data as T;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await res.json();
  if ((res.status === 401 || res.status === 403) && typeof window !== "undefined") {
    const authEntryPaths = new Set([
      "/companies/login",
      "/companies/recover/request",
      "/companies/recover/reset",
      "/employees/login",
      "/employees/recover/request",
      "/employees/recover/reset",
      "/companies/register",
      "/employees/register-self",
      "/employees/activate"
    ]);

    if (!authEntryPaths.has(path)) {
      clearStoredContexts();
      window.setTimeout(() => {
        window.location.href = "/";
      }, 0);
    }
  }
  if (!res.ok) {
    throw new ApiFetchError(data?.error ?? `API error ${res.status}`, res.status, data?.details);
  }
  return data as T;
}

// ── Types ────────────────────────────────────────────────────

export type Company = {
  id: string;
  name: string;
  email: string;
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
  last_payroll_at?: string | null;
  paid_this_period?: boolean;
  payroll_status?: "paid" | "due" | "scheduled";
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

export type LoanRequestResult = {
  decision: "approve" | "reject";
  loanId?: string;
  amount?: number;
  interest?: number;
  duration?: number;
  emi?: number;
  rationale?: string;
  autoApproved?: boolean;
  policy?: AgentPolicyResult;
};

export type LoanRepaymentResult = {
  loanId: string;
  status: "repaid";
  amountRepaid: number;
  txHash: string | null;
};

export type EmployeeWallet = {
  wallet_address: string;
  balance: string;
  max_withdrawable: string;
  token_symbol: string;
  chain: string;
};

export type WithdrawalResult = {
  txHash: string | null;
  amount: string;
  from: string;
  to: string;
  token_symbol: string;
};

export type LendingSummary = {
  active_loans: string;
  total_loans: string;
  total_issued: string;
  remaining_balance: string;
};

export type Transaction = {
  id: string;
  type: "deposit" | "payroll" | "loan_disbursement" | "emi_repayment" | "withdrawal" | "investment" | "treasury_allocation";
  amount: string;
  tx_hash: string | null;
  created_at: string;
  wallet_address?: string;
  token_symbol?: string;
};

export type TreasuryBalance = {
  balance: string;          // from walletService
  max_withdrawable?: string;
  chain?: string;
  wallet_address?: string;
  token_symbol?: string;
};

export type TreasuryAllocationSnapshot = {
  company_id: string;
  payroll_reserve: string;
  lending_pool: string;
  investment_pool: string;
  main_reserve: string;
  created_at: string | null;
  allocation: {
    payroll_reserve_pct: number;
    lending_pool_pct: number;
    investment_pool_pct: number;
    main_reserve_pct: number;
  };
};

export type PayrollHistoryEntry = {
  id: string;
  amount: string;
  created_at: string;
  tx_hash: string | null;
  employee_count: string;
};

export type TradingAgentsAllocationEntry = {
  protocolKey: string;
  protocol: string;
  action: "deposit" | "swap_to_pt" | "supply" | null;
  percent: number;
  amount_usdc: number;
};

export type TradingAgentsOverview = {
  configured: boolean;
  reachable: boolean;
  url: string | null;
  timeout_ms: number;
  enabled_protocols: string[];
  executable_protocols: string[];
  health: Record<string, unknown> | null;
  healthError: string | null;
  latestDecision: {
    timestamp: string;
    action: string | null;
    confidence: number | null;
    model_used: string | null;
    reasoning: string;
    execution_status: string | null;
    allocation: TradingAgentsAllocationEntry[];
  } | null;
};

export type InvestmentRunResult = {
  action: "DEPOSIT" | "REBALANCE" | "HOLD" | "WITHDRAW";
  confidence: number;
  reasoning: string;
  invested_amount: number;
  txHashes: string[];
  allocation: Record<string, {
    percent: number;
    amount_usdc: number;
    protocol: string;
    action: "deposit" | "swap_to_pt" | "supply";
  }>;
  policy?: AgentPolicyResult;
};

export type PayrollRunResult = {
  processed: number;
  payrollMonth: string;
  payrollMonthLabel: string;
  companySummaries: Array<{
    companyId: string;
    payrollMonth: string;
    payrollMonthLabel: string;
    activeEmployees: number;
    eligibleEmployees: number;
    alreadyPaidEmployees: number;
    processedEmployees: number;
    totalNetSalary: number;
  }>;
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
    accessPinConfigured?: boolean;
  };
  agent: {
    enabled: boolean;
    executionSource: string;
    slippageProtection: boolean;
    maxTradeSize: number;
    riskTolerance: string;
    rebalanceFrequency: string;
    lending_paused?: boolean;
    walletPolicy: {
      allowTreasuryAllocation: boolean;
      allowLoanDisbursal: boolean;
      allowPayroll: boolean;
      allowAaveRebalance: boolean;
      maxSingleTransfer: number;
      maxDailyOutflow: number;
      maxLoanAmount: number;
      maxAaveAllocationPct: number;
      humanReviewAbove: number;
    };
  };
  updated_at?: string;
};

// ── Company ──────────────────────────────────────────────────

export const fetchCompany = (id: string) =>
  apiFetch<Company>(`/companies/${id}`);

export const fetchCompanies = () =>
  apiFetch<{ companies: Company[] }>("/companies");

export const fetchCurrentCompanySession = () =>
  sessionFetch<{ company: Company }>("/companies/session");

export const registerCompany = (body: { name: string; email: string; accessPin: string }) =>
  apiFetch<{ company: Company; treasury_wallet: { wallet_address: string } }>("/companies/register", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const loginCompany = (body: { access: string; accessPin: string; email?: string }) =>
  apiFetch<{ company: Company }>("/companies/login", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const requestCompanyRecovery = (email: string) =>
  apiFetch<{ status: string; message: string }>("/companies/recover/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

export const resetCompanyRecovery = (body: { token: string; accessPin: string }) =>
  apiFetch<{ company: Company }>("/companies/recover/reset", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const logoutCompany = () =>
  apiFetch<{ status: string }>("/companies/logout", {
    method: "POST",
  });

export const updateCompanyAccessPin = (accessPin: string) =>
  apiFetch<{ status: string; accessPinConfigured: boolean }>("/companies/access-pin", {
    method: "POST",
    body: JSON.stringify({ accessPin }),
  });

// ── Treasury ─────────────────────────────────────────────────

export const fetchTreasuryBalance = (companyId: string) =>
  apiFetch<TreasuryBalance>(`/treasury/balance?companyId=${companyId}`);

export const fetchTreasuryAllocation = (companyId: string) =>
  apiFetch<TreasuryAllocationSnapshot>(`/treasury/allocation?companyId=${companyId}`);

export const withdrawTreasuryFunds = (body: {
  companyId: string;
  destinationAddress: string;
  amount: number;
}) =>
  apiFetch<WithdrawalResult>("/treasury/withdraw", {
    method: "POST",
    body: JSON.stringify(body),
  });

// ── Employees ────────────────────────────────────────────────

export const fetchEmployees = (companyId: string) =>
  apiFetch<{ employees: Employee[] }>(`/employees?companyId=${companyId}`);

export const fetchEmployee = (id: string) =>
  apiFetch<Employee>(`/employees/${id}`);

export const fetchEmployeeWallet = (employeeId: string) =>
  apiFetch<EmployeeWallet>(`/employees/${employeeId}/wallet`);

export const registerEmployeeWallet = (body: { fullName: string; email?: string; password: string }) =>
  apiFetch<{ employee: Employee; wallet: { wallet_address: string } }>("/employees/register-self", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const loginEmployee = (body: { access: string; password: string; email?: string }) =>
  apiFetch<{ employee: Employee }>("/employees/login", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const requestEmployeeRecovery = (email: string) =>
  apiFetch<{ status: string; message: string }>("/employees/recover/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

export const resetEmployeeRecovery = (body: { token: string; password: string }) =>
  apiFetch<{ employee: Employee }>("/employees/recover/reset", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const fetchCurrentEmployeeSession = () =>
  sessionFetch<{ employee: Employee }>("/employees/session");

export const logoutEmployee = () =>
  apiFetch<{ status: string }>("/employees/logout", {
    method: "POST",
  });

export const addEmployee = (body: {
  companyId: string;
  fullName: string;
  email: string;
  salary: number;
  creditScore?: number;
}) =>
  apiFetch<{ employee: Employee; activationToken: string; activationUrl: string }>("/employees/add", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const resendEmployeeInvite = (employeeId: string) =>
  apiFetch<{ employeeId: string; email: string; status: string; activationUrl: string }>(
    `/employees/${employeeId}/resend-invite`,
    { method: "POST" }
  );

export const withdrawEmployeeFunds = (employeeId: string, body: {
  destinationAddress: string;
  amount: number;
}) =>
  apiFetch<WithdrawalResult>(`/employees/${employeeId}/withdraw`, {
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
  apiFetch<LoanRequestResult>(
    "/loans/request",
    { method: "POST", body: JSON.stringify({ employeeId, requestedAmount }) }
  );

// ── Payroll ──────────────────────────────────────────────────

export const fetchPayrollHistory = (companyId: string) =>
  apiFetch<{ history: PayrollHistoryEntry[] }>(
    `/payroll/history?companyId=${companyId}`
  );

export const runPayroll = (companyId?: string) =>
  apiFetch<PayrollRunResult>("/payroll/run", {
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

export const runInvestment = (companyId: string) =>
  apiFetch<InvestmentRunResult>("/investments/run", {
    method: "POST",
    body: JSON.stringify({ companyId }),
  });

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
  workflow_id?: string | null;
  workflow_name?: string | null;
  stage?: string | null;
  source?: string | null;
  policy_result?: AgentPolicyResult | null;
  execution_status?: string | null;
  metadata?: Record<string, any> | null;
};

export type AgentPolicyResult = {
  status: "allow" | "review" | "block";
  reasons: string[];
  checks?: Array<Record<string, unknown>>;
  amount?: number;
  limits?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
};

export async function fetchAgentLogs(companyId?: string): Promise<{ logs: AgentLog[] }> {
  const search = new URLSearchParams();
  if (companyId) {
    search.set("companyId", companyId);
  }
  const query = search.toString();
  const res = await fetch(`/api/admin/agents/logs${query ? `?${query}` : ""}`, {
    cache: "no-store"
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `API error ${res.status}`);
  return data as { logs: AgentLog[] };
}

export const repayLoanInFull = (loanId: string, employeeId: string) =>
  apiFetch<LoanRepaymentResult>(
    `/loans/${loanId}/repay-full`,
    { method: "POST", body: JSON.stringify({ employeeId }) }
  );
