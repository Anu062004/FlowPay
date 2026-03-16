"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { PageHeader } from "../../components/PageHeader";
import { saveEmployeeContext } from "../../lib/companyContext";

export default function EmployeeActivatePage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);

  const handleActivate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const data = await apiFetch("/employees/activate", {
        method: "POST",
        body: JSON.stringify({ token, password })
      });
      setStatus(`Account activated for employee ${data.employeeId}`);
      setEmployeeId(data.employeeId);
      try {
        const profile = await apiFetch(`/employees/${data.employeeId}`);
        saveEmployeeContext({
          id: profile.id,
          fullName: profile.full_name ?? undefined,
          companyId: profile.company_id ?? undefined
        });
      } catch {
        saveEmployeeContext({ id: data.employeeId });
      }
    } catch (err: any) {
      setError(err.message ?? "Activation failed");
    }
  };

  return (
    <div className="stack">
      <PageHeader title="Activate Employee Account" subtitle="Set credentials to access payroll and loan features." />
      {!token ? (
        <div className="notice">Activation token missing. Please use the link from your invite email.</div>
      ) : (
        <form className="card stack" onSubmit={handleActivate}>
          <label className="label">Activation Token</label>
          <input value={token} disabled />
          <label className="label">Set Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="submit">Activate Account</button>
          {status ? <div className="label">{status}</div> : null}
          {error ? <div className="label" style={{ color: "var(--danger)" }}>{error}</div> : null}
          {employeeId ? (
            <div className="stack">
              <div className="label">Employee ID: {employeeId}</div>
              <Link className="btn btn-primary" href="/employee/overview">Go to Employee Portal</Link>
            </div>
          ) : null}
        </form>
      )}
    </div>
  );
}
