"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { PageHeader } from "../../components/PageHeader";
import { loadCompanyContext } from "../../lib/companyContext";

export default function EmployeeAddPage() {
  const [form, setForm] = useState({
    companyId: "",
    fullName: "",
    email: "",
    salary: "",
    creditScore: ""
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadCompanyContext();
    if (stored?.id) {
      setForm((prev) => ({ ...prev, companyId: stored.id }));
    }
  }, []);

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload = {
        companyId: form.companyId,
        fullName: form.fullName,
        email: form.email,
        salary: Number(form.salary),
        creditScore: form.creditScore ? Number(form.creditScore) : undefined
      };
      const data = await apiFetch("/employees/add", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setResult(data);
    } catch (err: any) {
      setError(err.message ?? "Failed to add employee");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title="Add Employee"
        subtitle="Create an employee wallet and send an activation invite."
      />
      <form className="card stack" onSubmit={handleSubmit}>
        <label className="label">Company ID</label>
        <input value={form.companyId} onChange={(e) => updateField("companyId", e.target.value)} required />
        <label className="label">Full Name</label>
        <input value={form.fullName} onChange={(e) => updateField("fullName", e.target.value)} required />
        <label className="label">Email</label>
        <input value={form.email} onChange={(e) => updateField("email", e.target.value)} required />
        <label className="label">Monthly Salary (ETH)</label>
        <input value={form.salary} onChange={(e) => updateField("salary", e.target.value)} required />
        <label className="label">Credit Score</label>
        <input value={form.creditScore} onChange={(e) => updateField("creditScore", e.target.value)} />
        <button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create Employee Wallet"}
        </button>
        {error ? <div className="label" style={{ color: "var(--danger)" }}>{error}</div> : null}
      </form>
      {result ? (
        <div className="card stack">
          <h2>Employee Created</h2>
          <div className="row">
            <div>
              <div className="label">Employee ID</div>
              <div>{result.employee.id}</div>
            </div>
            <div>
              <div className="label">Wallet Address</div>
              <div>{result.wallet.wallet_address}</div>
            </div>
          </div>
          {result.activationUrl ? (
            <div className="notice">
              Activation link (copy for the employee): {result.activationUrl}
            </div>
          ) : (
            <div className="notice">An activation email has been sent to {result.employee.email}.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
