"use client";
import { useState } from "react";
import { useLendingHistory } from "../lib/hooks";
import { requestLoan, type Loan } from "../lib/api";
import { loadCompanyContext } from "../lib/companyContext";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function Badge({ variant, children }: { variant: string; children: React.ReactNode }) {
  return <span className={`badge badge-${variant}`}><span className="badge-dot" />{children}</span>;
}

function fmt(val: string | number | null | undefined, prefix = "$"): string {
  if (val === null || val === undefined) return "—";
  const n = parseFloat(String(val));
  return isNaN(n) ? "—" : `${prefix}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Skeleton() {
  return <div style={{ height: 18, background: "var(--gray-100)", borderRadius: 4 }} />;
}

function calcProgress(loan: Loan): number {
  const total = parseFloat(loan.amount);
  const remaining = parseFloat(loan.remaining_balance);
  if (!total) return 0;
  return Math.round(((total - remaining) / total) * 100);
}

export default function LendingPage() {
  const { data, loading, error, refetch } = useLendingHistory();
  const [showIssueLoan, setShowIssueLoan] = useState(false);
  const [form, setForm] = useState({ employeeId: "", amount: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  const summary = data?.summary;
  const loans = data?.loans ?? [];

  async function handleIssue() {
    setSaving(true);
    setSaveError(null);
    setSaveResult(null);
    try {
      const result = await requestLoan(form.employeeId, parseFloat(form.amount));
      if (result.decision === "approve") {
        setSaveResult(`Loan approved — ${fmt(result.amount)} at ${result.emi ? fmt(result.emi) + "/mo EMI" : ""}`);
        setShowIssueLoan(false);
        refetch();
      } else {
        setSaveError("Loan rejected — employee does not meet eligibility criteria.");
      }
    } catch (err: any) {
      setSaveError(err.message ?? "Failed to issue loan");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack-xl">
      <div className="page-header-row">
        <div className="page-header">
          <h1 className="page-title">Lending</h1>
          <p className="page-subtitle">Employee loan portfolio and repayment tracking</p>
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={() => setShowIssueLoan(true)}>
            <Icon d="M12 4v16m8-8H4" size={14} />
            Issue Loan
          </button>
        </div>
      </div>

      {saveResult && (
        <div className="alert alert-success">
          <span className="alert-icon"><Icon d="M5 13l4 4L19 7" size={16} /></span>
          <span>{saveResult}</span>
        </div>
      )}

      {/* KPIs */}
      <div className="grid-4">
        {[
          { label: "Total Issued",        value: loading ? "—" : fmt(summary?.total_issued) },
          { label: "Active Loans",        value: loading ? "—" : String(summary?.active_loans ?? "—") },
          { label: "Outstanding Balance", value: loading ? "—" : fmt(summary?.remaining_balance) },
          { label: "Total Loans",         value: loading ? "—" : String(summary?.total_loans ?? "—") },
        ].map((s, i) => (
          <div key={i} className="metric-card">
            <div className="metric-card-label">{s.label}</div>
            {loading ? <Skeleton /> : (
              <div className="metric-card-value font-num" style={{ fontSize: "var(--text-3xl)" }}>{s.value}</div>
            )}
          </div>
        ))}
      </div>

      {/* Loan table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Loan Portfolio</div>
          <div className="card-subtitle">All employee loans and repayment status</div>
        </div>

        {error ? (
          <div className="card-body"><div className="alert alert-danger">{error}</div></div>
        ) : loading ? (
          <div className="card-body"><div className="stack"><Skeleton /><Skeleton /><Skeleton /></div></div>
        ) : loans.length === 0 ? (
          <div className="card-body">
            <div className="empty-state" style={{ padding: "48px 0" }}>
              <div className="empty-state-title">No loans issued yet</div>
              <div className="empty-state-desc">Issue your first loan to an employee using the button above.</div>
              <button className="btn btn-primary" onClick={() => setShowIssueLoan(true)}>Issue Loan</button>
            </div>
          </div>
        ) : (
          <>
            <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="right">Principal</th>
                    <th className="right">Rate</th>
                    <th>Term</th>
                    <th className="right">Outstanding</th>
                    <th style={{ minWidth: 140 }}>Repayment Progress</th>
                    <th>Status</th>
                    <th>Issued</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map((loan: Loan, i) => {
                    const progress = calcProgress(loan);
                    return (
                      <tr key={loan.id ?? i}>
                        <td>
                          <div className="fw-medium text-sm">{loan.full_name ?? "—"}</div>
                          <div className="text-xs text-secondary font-mono">{loan.id?.slice(0, 8)}…</div>
                        </td>
                        <td className="data-table-num">{fmt(loan.amount)}</td>
                        <td className="data-table-num">{parseFloat(loan.interest_rate).toFixed(1)}%</td>
                        <td className="text-sm">{loan.duration_months} mo</td>
                        <td className="data-table-num">{fmt(loan.remaining_balance)}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div className="progress-bar" style={{ flex: 1 }}>
                              <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                            </div>
                            <span className="text-xs text-secondary">{progress}%</span>
                          </div>
                        </td>
                        <td>
                          <Badge variant={
                            loan.status === "active" ? "warning" :
                            loan.status === "repaid" ? "success" :
                            loan.status === "rejected" ? "danger" : "neutral"
                          }>{loan.status}</Badge>
                        </td>
                        <td className="text-xs text-secondary" style={{ whiteSpace: "nowrap" }}>
                          {new Date(loan.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card-footer">
              <div className="row-between">
                <span className="text-sm text-secondary">{loans.length} loans total</span>
                <button className="btn btn-ghost btn-sm" onClick={refetch}>Refresh</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Issue Loan modal */}
      {showIssueLoan && (
        <div className="modal-backdrop" onClick={() => setShowIssueLoan(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Issue Employee Loan</div>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowIssueLoan(false)}>
                <Icon d="M6 18L18 6M6 6l12 12" size={16} />
              </button>
            </div>
            <div className="modal-body">
              {saveError && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{saveError}</div>}
              <div className="stack">
                <div className="form-group">
                  <label className="form-label">Employee ID</label>
                  <input className="form-input font-mono" placeholder="Paste employee UUID"
                    value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} />
                  <span className="form-hint">Find the employee ID from the Employees page.</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Requested Amount (USD)</label>
                  <div className="form-input-prefix">
                    <span className="form-input-prefix-symbol">$</span>
                    <input className="form-input" type="number" placeholder="10000"
                      value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                  </div>
                  <span className="form-hint">The AI agent will approve/reject based on credit score and salary.</span>
                </div>
                <div className="alert alert-info">
                  <span className="alert-icon"><Icon d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={16} /></span>
                  <span>Loan decisions are made by the FlowPay AI agent. Interest rate and term are determined automatically.</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowIssueLoan(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleIssue}
                disabled={saving || !form.employeeId || !form.amount}>
                {saving ? "Processing…" : "Submit to AI Agent"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
