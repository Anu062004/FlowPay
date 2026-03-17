"use client";
import { useState } from "react";
import { useEmployees, usePayrollHistory } from "../lib/hooks";
import { runPayroll } from "../lib/api";
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

function fmt(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  const n = parseFloat(String(val));
  return isNaN(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Skeleton({ h = 18 }: { h?: number }) {
  return <div style={{ height: h, background: "var(--gray-100)", borderRadius: 4 }} />;
}

// Simple bar chart from real employee salary data
function PayrollBar({ employees }: { employees: { full_name: string; salary: string }[] }) {
  if (!employees.length) return null;
  const maxSalary = Math.max(...employees.map(e => parseFloat(e.salary)));
  const top6 = employees.slice(0, 6);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 100 }}>
      {top6.map((e, i) => {
        const h = (parseFloat(e.salary) / maxSalary) * 100;
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%" }}>
            <div style={{ flex: 1, display: "flex", alignItems: "flex-end", width: "100%" }}>
              <div style={{ width: "100%", height: `${h}%`, background: "var(--accent-500)",
                borderRadius: "3px 3px 0 0", opacity: 0.85 }} />
            </div>
            <span style={{ fontSize: 10, color: "var(--text-tertiary)", whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis", maxWidth: 56, textAlign: "center" }}>
              {e.full_name.split(" ")[0]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function calculateEmi(amount: number, annualRate: number, months: number): number {
  const r = annualRate / 100 / 12;
  if (r === 0) return amount / months;
  return (amount * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

export default function PayrollPage() {
  const emps = useEmployees();
  const history = usePayrollHistory();
  const [showConfirm, setShowConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ processed: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const employees = emps.data?.employees ?? [];
  const historyList = history.data?.history ?? [];
  const totalPayroll = employees.reduce((s, e) => s + parseFloat(e.salary), 0);

  async function handleRunPayroll() {
    const ctx = loadCompanyContext();
    setRunning(true);
    setRunError(null);
    try {
      const result = await runPayroll(ctx?.id);
      setRunResult(result);
      setShowConfirm(false);
      history.refetch();
    } catch (err: any) {
      setRunError(err.message ?? "Payroll failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="stack-xl">
      <div className="page-header-row">
        <div className="page-header">
          <h1 className="page-title">Payroll</h1>
          <p className="page-subtitle">Automated salary disbursement and history</p>
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={() => setShowConfirm(true)}>
            <Icon d="M12 4v16m8-8H4" size={14} />
            Process Payroll
          </button>
        </div>
      </div>

      {runResult && (
        <div className="alert alert-success">
          <span className="alert-icon"><Icon d="M5 13l4 4L19 7" size={16} /></span>
          <span>Payroll processed successfully — <strong>{runResult.processed}</strong> employees paid.</span>
        </div>
      )}

      {/* KPIs */}
      <div className="grid-4">
        {[
          { label: "Total Monthly Salary", value: emps.loading ? "—" : fmt(totalPayroll) },
          { label: "Active Employees",     value: emps.loading ? "—" : String(employees.filter(e => e.status === "active").length) },
          { label: "Payroll Runs (All)",   value: history.loading ? "—" : String(historyList.length) },
          { label: "Total Disbursed",      value: history.loading ? "—" : fmt(historyList.reduce((s, h) => s + parseFloat(h.amount), 0)) },
        ].map((s, i) => (
          <div key={i} className="metric-card">
            <div className="metric-card-label">{s.label}</div>
            {emps.loading || history.loading ? <Skeleton /> : (
              <div className="metric-card-value font-num" style={{ fontSize: "var(--text-3xl)" }}>{s.value}</div>
            )}
          </div>
        ))}
      </div>

      {/* Salary breakdown */}
      <div className="grid-2-1">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Salary Breakdown</div>
            <div className="card-subtitle">Gross salary per employee</div>
          </div>
          {emps.loading ? (
            <div className="card-body"><div className="stack"><Skeleton /><Skeleton /></div></div>
          ) : employees.length === 0 ? (
            <div className="card-body">
              <div className="empty-state" style={{ padding: "32px 0" }}>
                <div className="empty-state-title">No employees</div>
              </div>
            </div>
          ) : (
            <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="right">Gross Salary</th>
                    <th className="right">Loan Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((e, i) => (
                    <tr key={e.id ?? i}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{e.full_name}</div>
                        <div className="text-xs text-secondary">{e.email}</div>
                      </td>
                      <td className="data-table-num">{fmt(e.salary)}</td>
                      <td className="data-table-num">
                        {parseFloat(e.outstanding_balance) > 0 ? fmt(e.outstanding_balance) : "—"}
                      </td>
                      <td>
                        <Badge variant={e.status === "active" ? "success" : "info"}>{e.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Bar chart */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Salary Distribution</div>
            <div className="card-subtitle">Top 6 by gross salary</div>
          </div>
          <div className="card-body">
            {emps.loading ? <Skeleton h={100} /> : <PayrollBar employees={employees} />}
          </div>
        </div>
      </div>

      {/* Payroll history */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Payroll History</div>
          <div className="card-subtitle">Past payroll run records</div>
        </div>
        {history.loading ? (
          <div className="card-body"><div className="stack"><Skeleton /><Skeleton /></div></div>
        ) : historyList.length === 0 ? (
          <div className="card-body">
            <div className="empty-state" style={{ padding: "32px 0" }}>
              <div className="empty-state-title">No payroll runs yet</div>
              <div className="empty-state-desc">Run your first payroll to see history here.</div>
            </div>
          </div>
        ) : (
          <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="right">Amount Disbursed</th>
                  <th>Employees Paid</th>
                  <th>Tx Hash</th>
                  <th className="right">Status</th>
                </tr>
              </thead>
              <tbody>
                {historyList.map((h, i) => (
                  <tr key={h.id ?? i}>
                    <td className="text-sm text-secondary" style={{ whiteSpace: "nowrap" }}>
                      {new Date(h.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="data-table-num">{fmt(h.amount)}</td>
                    <td className="text-sm">{h.employee_count}</td>
                    <td>
                      {h.tx_hash
                        ? <span className="font-mono text-xs text-secondary">{h.tx_hash.slice(0, 12)}…</span>
                        : <span className="text-tertiary text-xs">—</span>}
                    </td>
                    <td className="right">
                      <Badge variant="success">Completed</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Process payroll confirmation modal */}
      {showConfirm && (
        <div className="modal-backdrop" onClick={() => setShowConfirm(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Confirm Payroll Run</div>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowConfirm(false)}>
                <Icon d="M6 18L18 6M6 6l12 12" size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="stack">
                {[
                  ["Employees to pay", String(employees.filter(e => e.status === "active").length)],
                  ["Total gross payout", fmt(totalPayroll)],
                ].map(([k, v], i) => (
                  <div key={i} className="row-between" style={{ padding: "10px 0",
                    borderBottom: i === 0 ? "1px solid var(--border-subtle)" : "none" }}>
                    <span className="text-sm text-secondary">{k}</span>
                    <span className="fw-semi font-num text-sm">{v}</span>
                  </div>
                ))}
                {runError && <div className="alert alert-danger">{runError}</div>}
                <div className="alert alert-warning">
                  <span className="alert-icon"><Icon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" size={16} /></span>
                  <span>This will immediately disburse salaries on-chain. This action cannot be undone.</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleRunPayroll} disabled={running}>
                {running ? "Processing…" : "Confirm & Run Payroll"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
