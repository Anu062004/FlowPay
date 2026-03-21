"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ApiFetchError, apiFetch, type Employee } from "../../lib/api";
import { PageHeader } from "../../components/PageHeader";
import { saveEmployeeContext } from "../../lib/companyContext";

export const dynamic = "force-dynamic";

function EmployeeActivateInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  type ActivateResponse = { employeeId: string; employee: Employee };

  const handleActivate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setStatus(null);
    const trimmedPassword = password.trim();
    if (trimmedPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const data = await apiFetch<ActivateResponse>("/employees/activate", {
        method: "POST",
        body: JSON.stringify({ token, password: trimmedPassword })
      });
      setStatus(`Account activated for employee ${data.employeeId}`);
      setEmployeeId(data.employeeId);
      saveEmployeeContext({
        id: data.employee.id,
        fullName: data.employee.full_name ?? undefined,
        companyId: data.employee.company_id ?? undefined,
        companyName: data.employee.company_name ?? undefined,
        walletAddress: data.employee.wallet_address ?? null
      });
    } catch (err) {
      if (err instanceof ApiFetchError) {
        const fieldErrors = (err.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
        if (fieldErrors?.password?.length) {
          setError(fieldErrors.password[0] ?? "Password must be at least 8 characters.");
        } else if (err.status === 404) {
          setError("This invite link is invalid or already used. Ask your employer to resend the invitation.");
        } else {
          setError(err.message);
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Activation failed");
      }
    } finally {
      setSubmitting(false);
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
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <div className="label">Use at least 8 characters.</div>
          <button type="submit" disabled={submitting}>
            {submitting ? "Activating..." : "Activate Account"}
          </button>
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

export default function EmployeeActivatePage() {
  return (
    <Suspense fallback={<div className="stack"><PageHeader title="Activate Employee Account" subtitle="Loading..." /></div>}>
      <EmployeeActivateInner />
    </Suspense>
  );
}
