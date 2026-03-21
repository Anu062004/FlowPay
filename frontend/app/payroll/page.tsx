"use client";

import { useState } from "react";
import { runPayroll, type PayrollRunResult } from "../lib/api";
import { formatEth } from "../lib/format";
import { useEmployees, usePayrollHistory } from "../lib/hooks";
import { loadCompanyContext } from "../lib/companyContext";
import { getTransactionExplorerUrl } from "../lib/transactions";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

function Badge({ variant, children }: { variant: string; children: React.ReactNode }) {
  return (
    <span className={`badge badge-${variant}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}

function Skeleton({ h = 18 }: { h?: number }) {
  return <div style={{ height: h, background: "var(--gray-100)", borderRadius: 4 }} />;
}

function fmtEth(value: string | number | null | undefined) {
  return formatEth(value, 6, "ETH");
}

function isSameUtcPayrollMonth(isoDate: string, reference: Date) {
  const value = new Date(isoDate);
  return (
    value.getUTCFullYear() === reference.getUTCFullYear() &&
    value.getUTCMonth() === reference.getUTCMonth()
  );
}

function PayrollBar({ employees }: { employees: { full_name: string; salary: string }[] }) {
  if (!employees.length) return null;

  const maxSalary = Math.max(...employees.map((employee) => parseFloat(employee.salary)));
  const safeMax = maxSalary || 1;
  const topEmployees = employees.slice(0, 6);

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 100 }}>
      {topEmployees.map((employee) => {
        const ratio = parseFloat(employee.salary) / safeMax;
        const height = Math.max(ratio * 100, 4);
        return (
          <div
            key={employee.full_name}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              height: "100%",
            }}
          >
            <div style={{ flex: 1, display: "flex", alignItems: "flex-end", width: "100%" }}>
              <div
                style={{
                  width: "100%",
                  height: `${height}%`,
                  background: "var(--accent-500)",
                  borderRadius: "3px 3px 0 0",
                  opacity: 0.85,
                }}
              />
            </div>
            <span
              style={{
                fontSize: 10,
                color: "var(--text-tertiary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: 56,
                textAlign: "center",
              }}
            >
              {employee.full_name.split(" ")[0]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function PayrollPage() {
  const employeesHook = useEmployees();
  const historyHook = usePayrollHistory();
  const [showConfirm, setShowConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<PayrollRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const employees = employeesHook.data?.employees ?? [];
  const history = historyHook.data?.history ?? [];
  const now = new Date();
  const currentPayrollLabel = now.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const paidEmployees = activeEmployees.filter((employee) => employee.paid_this_period);
  const dueEmployees = activeEmployees.filter((employee) => !employee.paid_this_period);
  const totalGrossPayroll = activeEmployees.reduce((sum, employee) => sum + parseFloat(employee.salary), 0);
  const grossDuePayroll = dueEmployees.reduce((sum, employee) => sum + parseFloat(employee.salary), 0);
  const monthlyHistory = history.filter((entry) => isSameUtcPayrollMonth(entry.created_at, now));
  const totalDisbursed = monthlyHistory.reduce((sum, entry) => sum + parseFloat(entry.amount), 0);

  async function handleRunPayroll() {
    const companyContext = loadCompanyContext();
    setRunning(true);
    setRunError(null);
    try {
      const result = await runPayroll(companyContext?.id);
      setRunResult(result);
      setShowConfirm(false);
      employeesHook.refetch();
      historyHook.refetch();
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
          <p className="page-subtitle">Automated salary disbursement and payroll history in ETH.</p>
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={() => setShowConfirm(true)} disabled={dueEmployees.length === 0}>
            <Icon d="M12 4v16m8-8H4" size={14} />
            Process Payroll
          </button>
        </div>
      </div>

      {runResult ? (
        <div className="alert alert-success">
          <span className="alert-icon">
            <Icon d="M5 13l4 4L19 7" size={16} />
          </span>
          <span>
            {runResult.processed > 0
              ? <>Payroll processed successfully. <strong>{runResult.processed}</strong> employees paid for {runResult.payrollMonthLabel}.</>
              : <>Payroll is already complete for {runResult.payrollMonthLabel}. No employees were due.</>}
          </span>
        </div>
      ) : null}

      <div className="grid-4">
        {[
          { label: "Total Monthly Salary", value: employeesHook.loading ? "--" : fmtEth(totalGrossPayroll) },
          { label: "Due This Month", value: employeesHook.loading ? "--" : `${dueEmployees.length}` },
          { label: "Payroll Runs This Month", value: historyHook.loading ? "--" : String(monthlyHistory.length) },
          { label: "Disbursed This Month", value: historyHook.loading ? "--" : fmtEth(totalDisbursed) },
        ].map((item) => (
          <div key={item.label} className="metric-card">
            <div className="metric-card-label">{item.label}</div>
            {employeesHook.loading || historyHook.loading ? (
              <Skeleton />
            ) : (
              <div className="metric-card-value font-num" style={{ fontSize: "var(--text-3xl)" }}>
                {item.value}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid-2-1">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Salary Breakdown</div>
            <div className="card-subtitle">
              {dueEmployees.length} due and {paidEmployees.length} already paid for {currentPayrollLabel}.
            </div>
          </div>
          {employeesHook.loading ? (
            <div className="card-body">
              <div className="stack">
                <Skeleton />
                <Skeleton />
              </div>
            </div>
          ) : activeEmployees.length === 0 ? (
            <div className="card-body">
              <div className="empty-state" style={{ padding: "32px 0" }}>
                <div className="empty-state-title">No active employees</div>
                <div className="empty-state-desc">Add and activate employees before running payroll.</div>
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
                  {activeEmployees.map((employee) => (
                    <tr key={employee.id}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{employee.full_name}</div>
                        <div className="text-xs text-secondary">{employee.email}</div>
                      </td>
                      <td className="data-table-num">{fmtEth(employee.salary)}</td>
                      <td className="data-table-num">
                        {parseFloat(employee.outstanding_balance) > 0 ? fmtEth(employee.outstanding_balance) : "--"}
                      </td>
                      <td>
                        <Badge variant={employee.paid_this_period ? "success" : "warning"}>
                          {employee.paid_this_period ? "paid this month" : "due"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Salary Distribution</div>
            <div className="card-subtitle">Configured monthly salaries across active employees.</div>
          </div>
          <div className="card-body">
            {employeesHook.loading ? <Skeleton h={100} /> : <PayrollBar employees={activeEmployees} />}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Payroll History</div>
          <div className="card-subtitle">Completed payroll runs recorded on-chain.</div>
        </div>
          {historyHook.loading ? (
          <div className="card-body">
            <div className="stack">
              <Skeleton />
              <Skeleton />
            </div>
          </div>
          ) : history.length === 0 ? (
          <div className="card-body">
            <div className="empty-state" style={{ padding: "32px 0" }}>
              <div className="empty-state-title">No payroll runs yet</div>
              <div className="empty-state-desc">Run payroll once to populate this history.</div>
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
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td className="text-sm text-secondary" style={{ whiteSpace: "nowrap" }}>
                      {new Date(entry.created_at).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="data-table-num">{fmtEth(entry.amount)}</td>
                    <td className="text-sm">{String(entry.employee_count)}</td>
                    <td>
                      {entry.tx_hash ? (
                        <a
                          href={getTransactionExplorerUrl(entry.tx_hash)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-secondary"
                          title="Open transaction in explorer"
                        >
                          {entry.tx_hash.slice(0, 12)}...
                        </a>
                      ) : (
                        <span className="text-tertiary text-xs">--</span>
                      )}
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

      {showConfirm ? (
        <div className="modal-backdrop" onClick={() => setShowConfirm(false)}>
          <div className="modal modal-sm" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Confirm Payroll Run</div>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowConfirm(false)}>
                <Icon d="M6 18L18 6M6 6l12 12" size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="stack">
                {[
                  ["Employees to pay", String(dueEmployees.length)],
                  ["Already paid this month", String(paidEmployees.length)],
                  ["Total gross payout", fmtEth(grossDuePayroll)],
                ].map(([label, value], index) => (
                  <div
                    key={label}
                    className="row-between"
                    style={{
                      padding: "10px 0",
                      borderBottom: index < 2 ? "1px solid var(--border-subtle)" : "none",
                    }}
                  >
                    <span className="text-sm text-secondary">{label}</span>
                    <span className="fw-semi font-num text-sm">{value}</span>
                  </div>
                ))}
                {runError ? <div className="alert alert-danger">{runError}</div> : null}
                {dueEmployees.length === 0 ? (
                  <div className="alert alert-success">
                    <span className="alert-icon">
                      <Icon d="M5 13l4 4L19 7" size={16} />
                    </span>
                    <span>Payroll is already complete for {currentPayrollLabel}. Only unpaid employees are processed each month.</span>
                  </div>
                ) : null}
                <div className="alert alert-warning">
                  <span className="alert-icon">
                    <Icon
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      size={16}
                    />
                  </span>
                  <span>This will only pay employees who are still due for {currentPayrollLabel}. Already-paid employees are skipped.</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleRunPayroll} disabled={running || dueEmployees.length === 0}>
                {running ? "Processing..." : "Confirm & Run Payroll"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
