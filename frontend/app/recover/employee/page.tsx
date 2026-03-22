"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { requestEmployeeRecovery, resetEmployeeRecovery } from "../../lib/api";
import { saveEmployeeContext } from "../../lib/companyContext";
import { PageHeader } from "../../components/PageHeader";

export const dynamic = "force-dynamic";

function getSafeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  return value;
}

function EmployeeRecoveryInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const nextPath = getSafeNextPath(searchParams.get("next"));
  const hasToken = token.length > 0;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const title = useMemo(
    () => (hasToken ? "Set a new employee password" : "Recover employee password"),
    [hasToken]
  );

  const subtitle = hasToken
    ? "Choose a new password to restore access to the employee wallet workspace."
    : "Enter the employee email and FlowPay will send a reset link to the registered inbox.";

  const handleRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const response = await requestEmployeeRecovery(email.trim());
      setStatus(response.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send recovery email");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    if (password.trim().length < 8) {
      setError("Password must be at least 8 characters.");
      setBusy(false);
      return;
    }
    if (password !== confirmPassword) {
      setError("Password confirmation does not match.");
      setBusy(false);
      return;
    }
    try {
      const response = await resetEmployeeRecovery({ token, password: password.trim() });
      saveEmployeeContext({
        id: response.employee.id,
        fullName: response.employee.full_name ?? undefined,
        companyId: response.employee.company_id ?? undefined,
        companyName: response.employee.company_name ?? undefined,
        walletAddress: response.employee.wallet_address ?? null
      });
      router.push(nextPath ?? (response.employee.wallet_address ? "/employee/wallet" : "/employee/overview"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset employee password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader title={title} subtitle={subtitle} />
      <div className="card">
        <div className="card-body stack">
          {hasToken ? (
            <form className="stack" onSubmit={handleReset}>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input
                  className="form-input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input
                  className="form-input"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Updating..." : "Reset Employee Password"}
              </button>
            </form>
          ) : (
            <form className="stack" onSubmit={handleRequest}>
              <div className="form-group">
                <label className="form-label">Registered Employee Email</label>
                <input
                  className="form-input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="jane@company.com"
                  required
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Sending..." : "Send Recovery Email"}
              </button>
            </form>
          )}

          {status ? <div className="alert alert-success">{status}</div> : null}
          {error ? <div className="alert alert-danger">{error}</div> : null}

          <div className="row" style={{ gap: 12 }}>
            <Link className="btn btn-ghost" href="/">
              Back to Get In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EmployeeRecoveryPage() {
  return (
    <Suspense fallback={<div className="stack"><PageHeader title="Recover employee password" subtitle="Loading..." /></div>}>
      <EmployeeRecoveryInner />
    </Suspense>
  );
}
