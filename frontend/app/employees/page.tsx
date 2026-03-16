"use client";
import { useState } from "react";
import { useEmployees } from "../lib/hooks";
import { addEmployee, type Employee } from "../lib/api";
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

function Skeleton() {
  return <div style={{ height: 18, background: "var(--gray-100)", borderRadius: 4 }} />;
}

function ScorePill({ score }: { score: number }) {
  const color = score >= 800 ? "var(--success-600)" : score >= 700 ? "var(--warning-600)" : "var(--danger-600)";
  const bg = score >= 800 ? "var(--success-50)" : score >= 700 ? "var(--warning-50)" : "var(--danger-50)";
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color, background: bg,
      padding: "2px 8px", borderRadius: "var(--radius-full)" }}>{score}</span>
  );
}

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

function fmt(val: string | number | null | undefined, prefix = "$"): string {
  if (val === null || val === undefined) return "—";
  const n = parseFloat(String(val));
  return isNaN(n) ? "—" : `${prefix}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export default function EmployeesPage() {
  const { data, loading, error, refetch } = useEmployees();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  // Form state
  const [form, setForm] = useState({ fullName: "", email: "", salary: "", creditScore: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const employees = data?.employees ?? [];
  const filtered = employees.filter(e =>
    e.full_name.toLowerCase().includes(search.toLowerCase()) ||
    e.email.toLowerCase().includes(search.toLowerCase())
  );

  const totalPayroll = employees.reduce((s, e) => s + parseFloat(e.salary), 0);
  const avgScore = employees.length
    ? Math.round(employees.reduce((s, e) => s + e.credit_score, 0) / employees.length)
    : 0;
  const activeLoansCount = employees.filter(e => e.loan_status === "active").length;

  async function handleAddEmployee() {
    const ctx = loadCompanyContext();
    if (!ctx?.id) { setSaveError("No company selected."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      await addEmployee({
        companyId: ctx.id,
        fullName: form.fullName,
        email: form.email,
        salary: parseFloat(form.salary),
        creditScore: form.creditScore ? parseInt(form.creditScore) : undefined,
      });
      setShowAdd(false);
      setForm({ fullName: "", email: "", salary: "", creditScore: "" });
      refetch();
    } catch (err: any) {
      setSaveError(err.message ?? "Failed to add employee");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack-xl">
      <div className="page-header-row">
        <div className="page-header">
          <h1 className="page-title">Employees</h1>
          <p className="page-subtitle">
            {loading ? "Loading…" : `${employees.length} team members · ${activeLoansCount} active loans`}
          </p>
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <Icon d="M12 4v16m8-8H4" size={14} />
            Add Employee
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid-4">
        {[
          { label: "Total Employees",    value: loading ? "—" : String(employees.length) },
          { label: "Total Monthly Payroll", value: loading ? "—" : fmt(totalPayroll) },
          { label: "Avg Credit Score",   value: loading ? "—" : String(avgScore) },
          { label: "Active Loans",       value: loading ? "—" : String(activeLoansCount) },
        ].map((s, i) => (
          <div key={i} className="metric-card">
            <div className="metric-card-label">{s.label}</div>
            {loading ? <Skeleton /> : (
              <div className="metric-card-value font-num" style={{ fontSize: "var(--text-3xl)" }}>{s.value}</div>
            )}
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">All Employees</div>
          <div className="filter-bar">
            <div className="search-input-wrap">
              <span className="search-input-icon"><Icon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" size={14} /></span>
              <input className="search-input" placeholder="Search by name or email…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
        </div>

        {error ? (
          <div className="card-body"><div className="alert alert-danger">{error}</div></div>
        ) : loading ? (
          <div className="card-body"><div className="stack"><Skeleton /><Skeleton /><Skeleton /></div></div>
        ) : filtered.length === 0 ? (
          <div className="card-body">
            <div className="empty-state" style={{ padding: "48px 0" }}>
              <div className="empty-state-title">{employees.length === 0 ? "No employees yet" : "No results"}</div>
              <div className="empty-state-desc">
                {employees.length === 0
                  ? "Add your first employee to get started."
                  : "Try a different search term."}
              </div>
              {employees.length === 0 && (
                <button className="btn btn-primary" onClick={() => setShowAdd(true)}>Add Employee</button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Wallet Address</th>
                    <th className="right">Salary / mo</th>
                    <th className="right">Credit Score</th>
                    <th className="right">Loan Balance</th>
                    <th>Loan Status</th>
                    <th>Status</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((emp: Employee) => (
                    <tr key={emp.id}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <div style={{
                            width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                            background: "linear-gradient(135deg, var(--primary-600), var(--accent-600))",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 12, fontWeight: 700, color: "#fff",
                          }}>
                            {initials(emp.full_name)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{emp.full_name}</div>
                            <div className="text-xs text-secondary">{emp.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {emp.wallet_address
                          ? <span className="font-mono text-xs text-secondary">{emp.wallet_address.slice(0, 10)}…{emp.wallet_address.slice(-6)}</span>
                          : <span className="text-tertiary text-xs">Not set</span>}
                      </td>
                      <td className="data-table-num">{fmt(emp.salary)}</td>
                      <td className="right"><ScorePill score={emp.credit_score} /></td>
                      <td className="data-table-num">
                        {parseFloat(emp.outstanding_balance) > 0 ? fmt(emp.outstanding_balance) : "—"}
                      </td>
                      <td>
                        <Badge variant={emp.loan_status === "active" ? "warning" : "neutral"}>
                          {emp.loan_status === "active" ? "Active" : "None"}
                        </Badge>
                      </td>
                      <td>
                        <Badge variant={emp.status === "active" ? "success" : "info"}>
                          {emp.status}
                        </Badge>
                      </td>
                      <td className="right">
                        <button className="btn btn-ghost btn-sm">View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-footer">
              <div className="row-between">
                <span className="text-sm text-secondary">Showing {filtered.length} of {employees.length}</span>
                <button className="btn btn-ghost btn-sm" onClick={refetch}>Refresh</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Add Employee Modal */}
      {showAdd && (
        <div className="modal-backdrop" onClick={() => setShowAdd(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Add New Employee</div>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowAdd(false)}>
                <Icon d="M6 18L18 6M6 6l12 12" size={16} />
              </button>
            </div>
            <div className="modal-body">
              {saveError && <div className="alert alert-danger" style={{ marginBottom: 16 }}>{saveError}</div>}
              <div className="stack">
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input className="form-input" placeholder="Jane Doe"
                    value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" placeholder="jane@company.com"
                    value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Monthly Salary (USD)</label>
                    <div className="form-input-prefix">
                      <span className="form-input-prefix-symbol">$</span>
                      <input className="form-input" type="number" placeholder="10000"
                        value={form.salary} onChange={e => setForm(f => ({ ...f, salary: e.target.value }))} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Credit Score <span className="form-label-optional">(optional)</span></label>
                    <input className="form-input" type="number" min="300" max="850" placeholder="680"
                      value={form.creditScore} onChange={e => setForm(f => ({ ...f, creditScore: e.target.value }))} />
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddEmployee} disabled={saving || !form.fullName || !form.email || !form.salary}>
                {saving ? "Adding…" : "Add Employee"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
