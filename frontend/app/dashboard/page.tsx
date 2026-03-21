"use client";
import { useTreasuryAllocation, useTreasuryBalance, useEmployees, useLendingHistory, useTransactions } from "../lib/hooks";
import Link from "next/link";
import { formatEth } from "../lib/format";
import { AgentActivityFeed } from "../components/AgentActivityFeed";
import { apiFetch } from "../lib/api";
import { loadCompanyContext } from "../lib/companyContext";
import { useEffect, useState } from "react";

// ── Tiny helpers ─────────────────────────────────────────────
const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function fmt(val: string | number | undefined | null, symbol?: string): string {
  return formatEth(val, 6, symbol ?? "ETH");
}

function Badge({ variant, children }: { variant: string; children: React.ReactNode }) {
  return <span className={`badge badge-${variant}`}><span className="badge-dot" />{children}</span>;
}

function Skeleton({ w = "100%", h = 20 }: { w?: string | number; h?: number }) {
  return (
    <div style={{ width: w, height: h, background: "var(--gray-100)", borderRadius: 4,
      animation: "pulse 1.5s ease-in-out infinite" }} />
  );
}

// ── Inline sparkline (purely visual, derived from last 7 tx amounts) ─
function Sparkline({ values, color = "#10b981" }: { values: number[]; color?: string }) {
  if (!values.length) return null;
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const w = 120, h = 40;
  const pts = values.map((v, i) =>
    `${(i / Math.max(values.length - 1, 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`
  ).join(" ");
  const line = `M ${pts.split(" ").join(" L ")}`;
  const area = `${line} L ${w},${h} L 0,${h} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height: h, display: "block" }}>
      <defs>
        <linearGradient id={`sg${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.14" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg${color.replace("#","")})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Donut chart ───────────────────────────────────────────────
function DonutChart({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let cum = 0;
  const r = 40, cx = 50, cy = 50, circ = 2 * Math.PI * r;
  return (
    <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
      <svg width="100" height="100" style={{ flexShrink: 0 }}>
        {segments.map((seg, i) => {
          const pct = seg.value / total;
          const dash = circ * pct, gap = circ - dash;
          const rot = (cum / total) * 360 - 90;
          cum += seg.value;
          return <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color}
            strokeWidth="16" strokeDasharray={`${dash} ${gap}`} transform={`rotate(${rot} ${cx} ${cy})`} />;
        })}
        <circle cx={cx} cy={cy} r={r - 10} fill="white" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: seg.color }} />
            <span className="text-sm text-secondary" style={{ flex: 1 }}>{seg.label}</span>
            <span className="fw-semi font-num text-sm">{((seg.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const TX_TYPE_LABELS: Record<string, string> = {
  deposit: "Deposit",
  payroll: "Payroll",
  loan_disbursement: "Loan Disbursement",
  emi_repayment: "EMI Repayment",
  investment: "Investment",
  treasury_allocation: "Allocation",
};

const TX_BADGE: Record<string, string> = {
  deposit: "success",
  payroll: "primary",
  loan_disbursement: "warning",
  emi_repayment: "info",
  investment: "accent",
  treasury_allocation: "neutral",
};

// ═══════════════════════════════════════════════════════════
export default function OverviewPage() {
  const treasury = useTreasuryBalance();
  const treasuryAllocation = useTreasuryAllocation();
  const employees = useEmployees();
  const lending = useLendingHistory();
  const transactions = useTransactions(5);

  const balance = parseFloat(treasury.data?.balance ?? "0");
  const balanceSymbol = treasury.data?.token_symbol ?? "ETH";
  const empList = employees.data?.employees ?? [];
  const lendingSummary = lending.data?.summary;
  const txList = transactions.data?.transactions ?? [];

  const totalPayroll = empList.reduce((s, e) => s + parseFloat(e.salary), 0);
  const txAmounts = txList.map(t => parseFloat(t.amount));

  const allocationData = treasuryAllocation.data;
  const allocationSegments = [
    { label: "Salary Treasury", value: parseFloat(allocationData?.payroll_reserve ?? "0"), color: "#2563eb" },
    { label: "Lending Treasury", value: parseFloat(allocationData?.lending_pool ?? "0"), color: "#f59e0b" },
    { label: "Investment Treasury", value: parseFloat(allocationData?.investment_pool ?? "0"), color: "#10b981" },
    { label: "Main Treasury Reserve", value: parseFloat(allocationData?.main_reserve ?? "0"), color: "#64748b" },
  ].filter((segment) => segment.value > 0);

  const projectedAllocationSegments = balance > 0
    ? [
        { label: "Salary Treasury", value: balance * 0.5, color: "#2563eb" },
        { label: "Lending Treasury", value: balance * 0.2, color: "#f59e0b" },
        { label: "Investment Treasury", value: balance * 0.2, color: "#10b981" },
        { label: "Main Treasury Reserve", value: balance * 0.1, color: "#64748b" },
      ]
    : [];

  const visibleAllocationSegments = allocationSegments.length > 0 ? allocationSegments : projectedAllocationSegments;
  const loading = treasury.loading || employees.loading || lending.loading || treasuryAllocation.loading;
  const [aaveYieldEarned, setAaveYieldEarned] = useState<number>(0);

  useEffect(() => {
    const company = loadCompanyContext();
    if (!company?.id) {
      setAaveYieldEarned(0);
      return;
    }

    apiFetch<{ positions?: { yield_earned: string }[] }>(`/investments?companyId=${company.id}`)
      .then((data) => {
        const total = (data.positions ?? []).reduce((sum, position) => {
          return sum + parseFloat(position.yield_earned ?? "0");
        }, 0);
        setAaveYieldEarned(total);
      })
      .catch(() => {
        setAaveYieldEarned(0);
      });
  }, []);

  return (
    <div className="stack-xl">
      {/* Header */}
      <div className="page-header-row">
        <div className="page-header">
          <h1 className="page-title">Financial Overview</h1>
          <p className="page-subtitle">Real-time data from your treasury and operations</p>
        </div>
        <div className="row-wrap">
          <button className="btn btn-secondary">
            <Icon d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" size={14} />
            Export Report
          </button>
          <Link href="/treasury" className="btn btn-primary">
            <Icon d="M12 4v16m8-8H4" size={14} />
            Fund Treasury
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid-4">
        {/* Treasury Balance */}
        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Treasury Balance</div>
            <div className="metric-card-icon icon-bg-emerald">
              <Icon d="M3 10h18M7 15h.01M11 15h.01M3 7h18a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1z" size={16} />
            </div>
          </div>
          {loading ? <Skeleton h={36} /> : (
            <div className="metric-card-value font-num">{fmt(balance, balanceSymbol)}</div>
          )}
          <div style={{ margin: "8px 0" }}>
            <Sparkline values={txAmounts.slice(0, 7)} color="#10b981" />
          </div>
          <div className="metric-card-change neutral">Live on-chain balance</div>
        </div>

        {/* Monthly Payroll */}
        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Monthly Payroll</div>
            <div className="metric-card-icon icon-bg-blue">
              <Icon d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8" size={16} />
            </div>
          </div>
          {loading ? <Skeleton h={36} /> : (
            <div className="metric-card-value font-num">{fmt(totalPayroll, balanceSymbol)}</div>
          )}
          <div className="metric-card-change neutral">
            {empList.length} employees enrolled
          </div>
        </div>

        {/* Active Loans */}
        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Active Loans</div>
            <div className="metric-card-icon icon-bg-warning">
              <Icon d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16" size={16} />
            </div>
          </div>
          {loading ? <Skeleton h={36} /> : (
            <div className="metric-card-value font-num">{fmt(lendingSummary?.remaining_balance, balanceSymbol)}</div>
          )}
          <div className="metric-card-change neutral">
            {lendingSummary?.active_loans ?? "—"} active loans outstanding
          </div>
        </div>

        {/* Aave Yield Earned */}
        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Aave Yield Earned</div>
            <div className="metric-card-icon icon-bg-info">
              <Icon d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8" size={16} />
            </div>
          </div>
          <div className="metric-card-value font-num">{fmt(aaveYieldEarned, balanceSymbol)}</div>
          <div className="metric-card-change neutral">Total realized + unrealized Aave yield</div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid-2-1">
        {/* Recent Transactions */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Recent Transactions</div>
              <div className="card-subtitle">Latest treasury activity</div>
            </div>
            <Link href="/transactions" className="btn btn-ghost btn-sm">
              View all →
            </Link>
          </div>
          {transactions.loading ? (
            <div className="card-body"><div className="stack"><Skeleton /><Skeleton /><Skeleton /></div></div>
          ) : transactions.error ? (
            <div className="card-body"><div className="alert alert-danger">{transactions.error}</div></div>
          ) : txList.length === 0 ? (
            <div className="card-body">
              <div className="empty-state" style={{ padding: "32px 0" }}>
                <div className="empty-state-title">No transactions yet</div>
                <div className="empty-state-desc">Transactions will appear here once the treasury is funded.</div>
              </div>
            </div>
          ) : (
            <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th className="right">Amount ({balanceSymbol})</th>
                  </tr>
                </thead>
                <tbody>
                  {txList.map((tx, i) => (
                    <tr key={tx.id ?? i}>
                      <td className="text-xs text-secondary" style={{ whiteSpace: "nowrap" }}>
                        {new Date(tx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td>
                        <Badge variant={TX_BADGE[tx.type] ?? "neutral"}>
                          {TX_TYPE_LABELS[tx.type] ?? tx.type}
                        </Badge>
                      </td>
                      <td className="data-table-num">{fmt(tx.amount, tx.token_symbol ?? balanceSymbol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Capital Allocation Donut */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Capital Allocation</div>
              <div className="card-subtitle">Automatic 50% salary, 20% lending, 20% investment, 10% main reserve split</div>
            </div>
          </div>
          <div className="card-body">
            {treasuryAllocation.loading ? (
              <div className="stack"><Skeleton h={100} /></div>
            ) : visibleAllocationSegments.length > 0 ? (
              <div className="stack">
                <DonutChart segments={visibleAllocationSegments} />
                <div className="stack" style={{ gap: 10 }}>
                  {visibleAllocationSegments.map((segment) => (
                    <div key={segment.label} className="row-between">
                      <span className="text-sm text-secondary">{segment.label}</span>
                      <span className="fw-semi font-num text-sm">{fmt(segment.value, balanceSymbol)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty-state" style={{ padding: "24px 0" }}>
                <div className="empty-state-desc">No allocation data yet.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Errors */}
      {(treasury.error || treasuryAllocation.error || employees.error || lending.error) && (
        <div className="alert alert-warning">
          <span className="alert-icon"><Icon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" size={16} /></span>
          <div>
            Some data could not be loaded — ensure the backend is running and a company is selected.
            {treasury.error && <div className="text-xs" style={{ marginTop: 4 }}>Treasury: {treasury.error}</div>}
            {treasuryAllocation.error && <div className="text-xs">Allocation: {treasuryAllocation.error}</div>}
            {employees.error && <div className="text-xs">Employees: {employees.error}</div>}
            {lending.error && <div className="text-xs">Lending: {lending.error}</div>}
          </div>
        </div>
      )}

      {/* Agent Activity Feed */}
      <div className="grid-1">
        <AgentActivityFeed />
      </div>
    </div>
  );
}


