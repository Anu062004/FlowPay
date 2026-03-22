"use client";
import { useState } from "react";
import { repayLoanInFull, requestLoan, type Loan } from "../../lib/api";
import { useEmployee, useMyLoans } from "../../lib/hooks";
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
  return isNaN(n) ? "--" : `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDT`;
}

function Skeleton({ h = 20 }: { h?: number }) {
  return <div style={{ height: h, background: "var(--gray-100)", borderRadius: 4 }} />;
}

export default function EmployeeLoansPage() {
  const [ctx] = useState<EmployeeContext | null>(() => loadEmployeeContext());
  const [showRequest, setShowRequest] = useState(false);
  const [showRepayConfirm, setShowRepayConfirm] = useState(false);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [repaying, setRepaying] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, refetch } = useMyLoans();
  const profile = useEmployee(ctx?.id ?? null);

  const loans = data?.loans ?? [];
  const activeLoan = loans.find((l) => l.status === "active") ?? null;
  const pendingLoan = loans.find((l) => l.status === "pending") ?? null;
  const currentLoan = activeLoan ?? pendingLoan;
  const monthsPaid = activeLoan?.months_paid ?? 0;
  const term = activeLoan?.duration_months ?? 1;
  const remainingMonths = Math.max(term - monthsPaid, 0);
  const outstandingBalance = activeLoan ? parseFloat(activeLoan.remaining_balance) : 0;
  const totalRepayable = activeLoan ? Math.max((activeLoan.emi ?? 0) * term, outstandingBalance) : 0;
  const amountPaid = activeLoan ? Math.max(totalRepayable - outstandingBalance, 0) : 0;
  const progress = totalRepayable > 0 ? Math.round((amountPaid / totalRepayable) * 100) : 0;
  const salary = parseFloat(profile.data?.salary ?? "0");
  const maxEligible = salary * 2;
  const canRequestLoan = Boolean(ctx?.id) && !activeLoan && !pendingLoan && maxEligible > 0;

  async function handleRequestLoan() {
    if (!ctx?.id) return;

    const requestedAmount = parseFloat(amount);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      setActionError("Enter a valid positive loan amount.");
      return;
    }
    if (requestedAmount > maxEligible) {
      setActionError(`Loan amount exceeds your current limit of ${fmt(maxEligible)}.`);
      return;
    }

    setSubmitting(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await requestLoan(ctx.id, requestedAmount);
      if (result.decision === "approve") {
        const emiText = result.emi ? ` EMI ${fmt(result.emi)}/mo.` : "";
        const interestText = typeof result.interest === "number" ? ` ${result.interest.toFixed(1)}% APR.` : "";
        setActionMessage(
          `Loan approved and disbursed.${interestText}${emiText}${result.rationale ? ` ${result.rationale}` : ""}`
        );
        setShowRequest(false);
        setAmount("");
      } else {
        setShowRequest(false);
        setAmount("");
        setActionError(result.rationale ?? "Loan request was rejected.");
      }
      await refetch();
    } catch (err: any) {
      setActionError(err?.message ?? "Failed to submit loan request.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRepayLoanInFull() {
    if (!ctx?.id || !activeLoan?.id) {
      return;
    }

    setRepaying(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await repayLoanInFull(activeLoan.id, ctx.id);
      setActionMessage(
        `Loan fully repaid. ${fmt(result.amountRepaid)} moved back to treasury${result.txHash ? ` (tx ${result.txHash.slice(0, 12)}...).` : "."}`
      );
      setShowRepayConfirm(false);
      await refetch();
    } catch (err: any) {
      setActionError(err?.message ?? "Failed to repay loan in full.");
    } finally {
      setRepaying(false);
    }
  }

  if (!ctx) {
    return (
      <div className="stack-xl">
        <div className="page-header"><h1 className="page-title">My Loans</h1></div>
        <EmployeeSessionPrompt />
      </div>
    );
  }

  return (
    <div className="stack-xl">
      <div className="page-header-row">
        <div className="page-header">
          <h1 className="page-title">My Loans</h1>
          <p className="page-subtitle">Salary-backed loan requests and repayment tracking</p>
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={() => setShowRequest(true)} disabled={!canRequestLoan}>
            <Icon d="M12 4v16m8-8H4" size={14} />
            Request Loan
          </button>
        </div>
      </div>

      {actionMessage ? (
        <div className="alert alert-success">
          <span className="alert-icon"><Icon d="M5 13l4 4L19 7" size={16} /></span>
          <span>{actionMessage}</span>
        </div>
      ) : null}
      {actionError ? (
        <div className="alert alert-danger">
          <span className="alert-icon"><Icon d="M6 18L18 6M6 6l12 12" size={16} /></span>
          <span>{actionError}</span>
        </div>
      ) : null}

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Borrow Against Salary</div>
            <div className="card-subtitle">FlowPay agent evaluates your request and disburses approved loans automatically.</div>
          </div>
        </div>
        <div className="card-body">
          <div className="grid-4">
            <div style={{ textAlign: "center", padding: "16px", background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <div className="text-xs text-tertiary" style={{ textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Monthly Salary</div>
              {profile.loading ? <Skeleton h={28} /> : <div className="fw-bold font-num" style={{ fontSize: "var(--text-xl)" }}>{fmt(profile.data?.salary)}</div>}
            </div>
            <div style={{ textAlign: "center", padding: "16px", background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <div className="text-xs text-tertiary" style={{ textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Credit Score</div>
              {profile.loading ? <Skeleton h={28} /> : <div className="fw-bold font-num" style={{ fontSize: "var(--text-xl)" }}>{profile.data?.credit_score ?? "--"}</div>}
            </div>
            <div style={{ textAlign: "center", padding: "16px", background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <div className="text-xs text-tertiary" style={{ textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Current Limit</div>
              {profile.loading ? <Skeleton h={28} /> : <div className="fw-bold font-num text-primary" style={{ fontSize: "var(--text-xl)" }}>{fmt(maxEligible)}</div>}
            </div>
            <div style={{ textAlign: "center", padding: "16px", background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
              <div className="text-xs text-tertiary" style={{ textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Request Status</div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Badge variant={activeLoan ? "warning" : pendingLoan ? "info" : "success"}>
                  {activeLoan ? "Active Loan" : pendingLoan ? "Pending" : "Eligible"}
                </Badge>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            {activeLoan ? (
              <div className="alert alert-warning">
                <span className="alert-icon"><Icon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" size={16} /></span>
                <span>You already have an active loan. Repay or close it before requesting another.</span>
              </div>
            ) : pendingLoan ? (
              <div className="alert alert-info">
                <span className="alert-icon"><Icon d="M12 8v4l3 3" size={16} /></span>
                <span>You already have a pending loan request on file. Wait until it is resolved before submitting a new one.</span>
              </div>
            ) : (
              <div className="alert alert-info">
                <span className="alert-icon"><Icon d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={16} /></span>
                <span>Approved requests are disbursed immediately to your employee wallet. Rate and duration are set automatically by the loan agent.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card"><div className="card-body"><div className="stack"><Skeleton h={40} /><Skeleton /><Skeleton /></div></div></div>
      ) : error ? (
        <div className="alert alert-danger">{error}</div>
      ) : !currentLoan ? (
        <div className="card">
          <div className="card-body">
            <div className="empty-state" style={{ padding: "48px 0" }}>
              <div className="empty-state-title">No active loans</div>
              <div className="empty-state-desc">
                {canRequestLoan
                  ? "You are all clear. Use the Request Loan action above when you need a new salary-backed advance."
                  : "Loan eligibility will appear here once your salary profile is ready and there is no existing pending request."}
              </div>
            </div>
          </div>
        </div>
      ) : activeLoan ? (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Active Loan - {activeLoan.id?.slice(0, 8)}...</div>
              <div className="card-subtitle">
                Issued {new Date(activeLoan.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </div>
            </div>
            <Badge variant="warning">Active</Badge>
          </div>
          <div className="card-body">
            <div className="grid-4">
              {[
                { label: "Original Principal", value: fmt(activeLoan.amount) },
                { label: "Outstanding Balance", value: fmt(activeLoan.remaining_balance), highlight: true },
                { label: "Monthly EMI", value: fmt(activeLoan.emi) },
                { label: "Interest Rate", value: `${parseFloat(activeLoan.interest_rate).toFixed(1)}% p.a.` },
              ].map((s, i) => (
                <div key={i} style={{ textAlign: "center", padding: "16px", background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                  <div className="text-xs text-tertiary" style={{ textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{s.label}</div>
                  <div className={`fw-bold font-num ${s.highlight ? "text-warning" : "text-primary"}`} style={{ fontSize: "var(--text-xl)" }}>{s.value}</div>
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
                    {fmt(amountPaid)}
                  </strong>
                </span>
                <span className="text-xs text-secondary">{remainingMonths} months remaining</span>
              </div>
            </div>
          </div>
          <div className="card-footer">
            <div className="row-between">
              <span className="text-sm text-secondary">EMI auto-deducted from salary on payroll date, or repay the full balance now.</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => setShowRepayConfirm(true)} disabled={repaying}>
                  Pay {fmt(activeLoan.remaining_balance)} Now
                </button>
                <button className="btn btn-ghost btn-sm" onClick={refetch}>Refresh</button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Pending Loan Request</div>
              <div className="card-subtitle">Submitted {new Date(pendingLoan!.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
            </div>
            <Badge variant="info">Pending</Badge>
          </div>
          <div className="card-body">
            <div className="grid-3">
              <div style={{ textAlign: "center", padding: "16px", background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                <div className="text-xs text-tertiary" style={{ textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Requested Principal</div>
                <div className="fw-bold font-num" style={{ fontSize: "var(--text-xl)" }}>{fmt(pendingLoan!.amount)}</div>
              </div>
              <div style={{ textAlign: "center", padding: "16px", background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                <div className="text-xs text-tertiary" style={{ textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Proposed EMI</div>
                <div className="fw-bold font-num" style={{ fontSize: "var(--text-xl)" }}>{fmt(pendingLoan!.emi)}</div>
              </div>
              <div style={{ textAlign: "center", padding: "16px", background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
                <div className="text-xs text-tertiary" style={{ textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Term</div>
                <div className="fw-bold font-num" style={{ fontSize: "var(--text-xl)" }}>{pendingLoan!.duration_months} mo</div>
              </div>
            </div>
          </div>
        </div>
      )}

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
                      <Badge variant={l.status === "active" ? "warning" : l.status === "pending" ? "info" : l.status === "repaid" ? "success" : "danger"}>
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

      {showRequest && (
        <div className="modal-backdrop" onClick={() => setShowRequest(false)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Request Salary-Backed Loan</div>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowRequest(false)}>
                <Icon d="M6 18L18 6M6 6l12 12" size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="stack">
                <div className="row-between" style={{ paddingBottom: 12, borderBottom: "1px solid var(--border-subtle)" }}>
                  <span className="text-sm text-secondary">Current limit</span>
                  <span className="fw-semi font-num text-sm">{fmt(maxEligible)}</span>
                </div>
                <div className="row-between" style={{ paddingBottom: 12, borderBottom: "1px solid var(--border-subtle)" }}>
                  <span className="text-sm text-secondary">Monthly salary</span>
                  <span className="fw-semi font-num text-sm">{fmt(profile.data?.salary)}</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Requested Amount (USDT)</label>
                  <input
                    className="form-input"
                    type="number"
                    placeholder="0.005"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <span className="form-hint">Maximum request is 2x your salary. Approved loans are disbursed automatically.</span>
                </div>
                <div className="alert alert-info">
                  <span className="alert-icon"><Icon d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={16} /></span>
                  <span>The FlowPay loan agent decides amount, rate, and duration. If approved, funds are sent directly to your employee wallet.</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowRequest(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleRequestLoan} disabled={submitting || !amount}>
                {submitting ? "Submitting..." : "Submit Loan Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRepayConfirm && activeLoan && (
        <div className="modal-backdrop" onClick={() => setShowRepayConfirm(false)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Repay Loan In Full</div>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowRepayConfirm(false)} disabled={repaying}>
                <Icon d="M6 18L18 6M6 6l12 12" size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="stack">
                <div className="row-between" style={{ paddingBottom: 12, borderBottom: "1px solid var(--border-subtle)" }}>
                  <span className="text-sm text-secondary">Outstanding balance</span>
                  <span className="fw-semi font-num text-sm">{fmt(activeLoan.remaining_balance)}</span>
                </div>
                <div className="row-between" style={{ paddingBottom: 12, borderBottom: "1px solid var(--border-subtle)" }}>
                  <span className="text-sm text-secondary">Monthly EMI</span>
                  <span className="fw-semi font-num text-sm">{fmt(activeLoan.emi)}</span>
                </div>
                <div className="row-between" style={{ paddingBottom: 12, borderBottom: "1px solid var(--border-subtle)" }}>
                  <span className="text-sm text-secondary">Effect</span>
                  <span className="fw-semi text-sm">Loan closes immediately</span>
                </div>
                <div className="alert alert-warning">
                  <span className="alert-icon"><Icon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" size={16} /></span>
                  <span>Funds are debited from your employee wallet. Keep enough USDT for the repayment amount and enough native ETH for network gas.</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowRepayConfirm(false)} disabled={repaying}>Cancel</button>
              <button className="btn btn-danger" onClick={handleRepayLoanInFull} disabled={repaying}>
                {repaying ? "Repaying..." : `Repay ${fmt(activeLoan.remaining_balance)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
