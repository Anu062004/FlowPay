"use client";

import { useEffect, useState } from "react";
import { useMyLoans, useMyTransactions } from "../../lib/hooks";
import { loadEmployeeContext, type EmployeeContext } from "../../lib/companyContext";
import Link from "next/link";
import EmployeeSessionPrompt from "../../components/EmployeeSessionPrompt";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function fmt(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "--";
  const n = parseFloat(String(val));
  return isNaN(n) ? "--" : `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ETH`;
}

function Badge({ variant, children }: { variant: string; children: React.ReactNode }) {
  return <span className={`badge badge-${variant}`}><span className="badge-dot" />{children}</span>;
}

function Skeleton({ h = 20 }: { h?: number }) {
  return <div style={{ height: h, background: "var(--gray-100)", borderRadius: 4 }} />;
}

const TX_TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit",
  payroll: "Salary Received",
  loan_disbursement: "Loan Disbursed",
  emi_repayment: "EMI Deduction",
  investment: "Investment",
  treasury_allocation: "Allocation",
};
const TX_BADGE: Record<string, string> = {
  payroll: "success", loan_disbursement: "primary", emi_repayment: "warning",
  deposit: "success", investment: "accent", treasury_allocation: "neutral",
};

export default function EmployeeOverviewPage() {
  const [ctx, setCtx] = useState<EmployeeContext | null>(null);

  useEffect(() => {
    setCtx(loadEmployeeContext());
  }, []);

  const loans = useMyLoans();
  const txHook = useMyTransactions();

  const txList = txHook.data?.transactions ?? [];
  const activeLoan = loans.data?.loans.find(l => l.status === "active") ?? null;
  const monthsPaid = activeLoan?.months_paid ?? 0;
  const term = activeLoan?.duration_months ?? 1;

  // Compute wallet balance: sum of inflows minus outflows from transactions
  const walletBalance = txList.reduce((s, t) => {
    if (t.type === "payroll" || t.type === "loan_disbursement") return s + parseFloat(t.amount);
    return s; // withdrawals would appear separately (not in this ledger)
  }, 0);

  // Last salary from transactions
  const lastSalaryTx = txList.find(t => t.type === "payroll");

  if (!ctx) {
    return (
      <div className="stack-xl">
        <div className="page-header">
          <h1 className="page-title">My Overview</h1>
        </div>
        <EmployeeSessionPrompt onSet={setCtx} />
      </div>
    );
  }

  return (
    <div className="stack-xl">
      <div className="page-header">
        <h1 className="page-title">My Overview</h1>
        <p className="page-subtitle">
          {ctx.fullName ? `Welcome, ${ctx.fullName.split(" ")[0]}` : "Personal financial summary"}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid-3">
        {/* Approx wallet balance */}
        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Received (Lifetime)</div>
            <div className="metric-card-icon icon-bg-emerald">
              <Icon d="M3 10h18M7 15h.01M11 15h.01M3 7h18a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1z" size={16} />
            </div>
          </div>
          {txHook.loading ? <Skeleton h={36} /> : (
            <div className="metric-card-value font-num">{fmt(walletBalance)}</div>
          )}
          <div className="metric-card-change neutral">Total salary + loan proceeds</div>
        </div>

        {/* Last salary */}
        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Last Salary</div>
            <div className="metric-card-icon icon-bg-blue">
              <Icon d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8" size={16} />
            </div>
          </div>
          {txHook.loading ? <Skeleton h={36} /> : (
            <div className="metric-card-value font-num">{lastSalaryTx ? fmt(lastSalaryTx.amount) : "--"}</div>
          )}
          <div className="metric-card-change neutral">
            {lastSalaryTx
              ? new Date(lastSalaryTx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              : "No salary received yet"}
          </div>
        </div>

        {/* Active loan */}
        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Active Loan Balance</div>
            <div className="metric-card-icon icon-bg-warning">
              <Icon d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16" size={16} />
            </div>
          </div>
          {loans.loading ? <Skeleton h={36} /> : (
            <div className="metric-card-value font-num">{activeLoan ? fmt(activeLoan.remaining_balance) : "No active loan"}</div>
          )}
          {activeLoan && (
            <div style={{ margin: "8px 0" }}>
              <div className="progress-bar" style={{ height: 6 }}>
                <div className="progress-bar-fill" style={{ width: `${Math.round((monthsPaid / term) * 100)}%` }} />
              </div>
            </div>
          )}
          <div className="metric-card-change neutral">
            {activeLoan ? `${monthsPaid}/${term} months paid · EMI: ${fmt(activeLoan.emi)}/mo` : "All clear"}
          </div>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Recent Activity</div>
          <Link href="/employee/transactions" className="btn btn-ghost btn-sm">View all ?</Link>
        </div>
        {txHook.loading ? (
          <div className="card-body"><div className="stack"><Skeleton /><Skeleton /><Skeleton /></div></div>
        ) : txHook.error ? (
          <div className="card-body"><div className="alert alert-danger">{txHook.error}</div></div>
        ) : txList.length === 0 ? (
          <div className="card-body">
            <div className="empty-state" style={{ padding: "32px 0" }}>
              <div className="empty-state-title">No activity yet</div>
              <div className="empty-state-desc">Transactions will appear once salary or loans are processed.</div>
            </div>
          </div>
        ) : (
          <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="right">Amount (ETH)</th>
                </tr>
              </thead>
              <tbody>
                {txList.slice(0, 5).map((tx, i) => (
                  <tr key={tx.id ?? i}>
                    <td className="text-xs text-secondary" style={{ whiteSpace: "nowrap" }}>
                      {new Date(tx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </td>
                    <td>
                      <Badge variant={TX_BADGE[tx.type] ?? "neutral"}>
                        {TX_TYPE_LABEL[tx.type] ?? tx.type}
                      </Badge>
                    </td>
                    <td className={`data-table-num ${tx.type === "payroll" || tx.type === "loan_disbursement" ? "text-success" : ""}`}>
                      {fmt(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="grid-3">
        {[
          { title: "My Wallet", desc: "View balance and withdraw funds", href: "/employee/wallet", icon: "M3 10h18M7 15h.01M11 15h.01M3 7h18a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1z" },
          { title: "My Loan",   desc: "Track repayment progress",     href: "/employee/loans",  icon: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16" },
          { title: "Transactions", desc: "Full transaction history",  href: "/employee/transactions", icon: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" },
        ].map((l, i) => (
          <Link key={i} href={l.href} style={{ textDecoration: "none" }} className="card">
            <div className="card-body">
              <div className="row" style={{ gap: 12, marginBottom: 8 }}>
                <div className="metric-card-icon icon-bg-emerald">
                  <Icon d={l.icon} size={16} />
                </div>
                <div className="card-title">{l.title}</div>
              </div>
              <div className="text-sm text-secondary">{l.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
