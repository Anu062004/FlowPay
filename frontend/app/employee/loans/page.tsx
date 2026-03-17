"use client";
import { useEffect, useState } from "react";
import { useMyLoans } from "../../lib/hooks";
import { type Loan } from "../../lib/api";
import { loadEmployeeContext, type EmployeeContext } from "../../lib/companyContext";
import EmployeeSessionPrompt from "../../components/EmployeeSessionPrompt";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function Badge({ variant, children }: { variant: string; children: React.ReactNode }) {
  return <span className={`badge badge-${variant}`}><span className="badge-dot" />{children}</span>;
}

function fmt(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "--";
  const n = parseFloat(String(val));
  return isNaN(n) ? "--" : `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ETH`;
}

function Skeleton({ h = 20 }: { h?: number }) {
  return <div style={{ height: h, background: "var(--gray-100)", borderRadius: 4 }} />;
}

export default function EmployeeLoansPage() {
  const [ctx, setCtx] = useState<EmployeeContext | null>(null);

  useEffect(() => {
    setCtx(loadEmployeeContext());
  }, []);

  const { data, loading, error, refetch } = useMyLoans();

  const loans = data?.loans ?? [];
  const activeLoan = loans.find(l => l.status === "active") ?? null;
  const monthsPaid = activeLoan?.months_paid ?? 0;
  const term = activeLoan?.duration_months ?? 1;
  const remainingMonths = term - monthsPaid;
  const progress = Math.round((monthsPaid / term) * 100);

  if (!ctx) {
    return (
      <div className="stack-xl">
        <div className="page-header"><h1 className="page-title">My Loans</h1></div>
        <EmployeeSessionPrompt onSet={setCtx} />
      </div>
    );
  }

  return (
    <div className="stack-xl">
      <div className="page-header">
        <h1 className="page-title">My Loans</h1>
        <p className="page-subtitle">Salary-backed loan portfolio and repayment schedule</p>
      </div>

      {/* Active loan card */}
      {loading ? (
        <div className="card"><div className="card-body"><div className="stack"><Skeleton h={40} /><Skeleton /><Skeleton /></div></div></div>
      ) : error ? (
        <div className="alert alert-danger">{error}</div>
      ) : !activeLoan ? (
        <div className="card">
          <div className="card-body">
            <div className="empty-state" style={{ padding: "48px 0" }}>
              <div className="empty-state-title">No active loans</div>
              <div className="empty-state-desc">You are all clear — no outstanding loan balance.</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Active Loan — {activeLoan.id?.slice(0, 8)}...</div>
              <div className="card-subtitle">
                Issued {new Date(activeLoan.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </div>
            </div>
            <Badge variant="warning">Active</Badge>
          </div>
          <div className="card-body">
            <div className="grid-4">
              {[
                { label: "Original Principal",  value: fmt(activeLoan.amount) },
                { label: "Outstanding Balance", value: fmt(activeLoan.remaining_balance), highlight: true },
                { label: "Monthly EMI",         value: fmt(activeLoan.emi) },
                { label: "Interest Rate",        value: `${parseFloat(activeLoan.interest_rate).toFixed(1)}% p.a.` },
              ].map((s, i) => (
                <div key={i} style={{ textAlign: "center", padding: "16px", background: "var(--bg-muted)",
                  borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                  <div className="text-xs text-tertiary" style={{ textTransform: "uppercase",
                    letterSpacing: "0.06em", marginBottom: 6 }}>{s.label}</div>
                  <div className={`fw-bold font-num ${s.highlight ? "text-warning" : "text-primary"}`}
                    style={{ fontSize: "var(--text-xl)" }}>{s.value}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 28 }}>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <span className="text-sm fw-medium">Repayment Progress</span>
                <span className="text-sm text-secondary">{monthsPaid} of {term} months paid</span>
              </div>
              <div className="loan-progress-bar">
                <div className="loan-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="row-between" style={{ marginTop: 8 }}>
                <span className="text-xs text-secondary">
                  Paid: <strong className="text-success">
                    {fmt(parseFloat(activeLoan.amount) - parseFloat(activeLoan.remaining_balance))}
                  </strong>
                </span>
                <span className="text-xs text-secondary">{remainingMonths} months remaining</span>
              </div>
            </div>
          </div>
          <div className="card-footer">
            <div className="row-between">
              <span className="text-sm text-secondary">EMI auto-deducted from salary on payroll date</span>
              <button className="btn btn-ghost btn-sm" onClick={refetch}>Refresh</button>
            </div>
          </div>
        </div>
      )}

      {/* Loan history */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">All Loans</div>
        </div>
        {loading ? (
          <div className="card-body"><div className="stack"><Skeleton /></div></div>
        ) : loans.length === 0 ? (
          <div className="card-body">
            <div className="empty-state" style={{ padding: "24px 0" }}>
              <div className="empty-state-desc">No loan history.</div>
            </div>
          </div>
        ) : (
          <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Loan ID</th>
                  <th className="right">Principal</th>
                  <th className="right">Rate</th>
                  <th>Term</th>
                  <th className="right">Remaining</th>
                  <th className="right">EMI</th>
                  <th>Status</th>
                  <th>Issued</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l: Loan, i) => (
                  <tr key={l.id ?? i}>
                    <td className="font-mono text-xs text-secondary">{l.id?.slice(0, 10)}...</td>
                    <td className="data-table-num">{fmt(l.amount)}</td>
                    <td className="data-table-num">{parseFloat(l.interest_rate).toFixed(1)}%</td>
                    <td className="text-sm">{l.duration_months} mo</td>
                    <td className="data-table-num">{fmt(l.remaining_balance)}</td>
                    <td className="data-table-num">{l.emi ? fmt(l.emi) : "--"}</td>
                    <td>
                      <Badge variant={l.status === "active" ? "warning" : l.status === "repaid" ? "success" : "danger"}>
                        {l.status}
                      </Badge>
                    </td>
                    <td className="text-xs text-secondary">
                      {new Date(l.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

