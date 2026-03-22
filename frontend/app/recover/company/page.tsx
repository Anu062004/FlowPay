"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { requestCompanyRecovery, resetCompanyRecovery } from "../../lib/api";
import { saveCompanyContext } from "../../lib/companyContext";
import { PageHeader } from "../../components/PageHeader";

export const dynamic = "force-dynamic";

function getSafeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  return value;
}

function CompanyRecoveryInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const nextPath = getSafeNextPath(searchParams.get("next"));
  const hasToken = token.length > 0;
  const [email, setEmail] = useState("");
  const [accessPin, setAccessPin] = useState("");
  const [confirmAccessPin, setConfirmAccessPin] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const title = useMemo(
    () => (hasToken ? "Set a new company PIN" : "Recover company PIN"),
    [hasToken]
  );

  const subtitle = hasToken
    ? "Choose a new company PIN to restore employer dashboard access."
    : "Enter the company email and FlowPay will send a reset link to the registered inbox.";

  const handleRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const response = await requestCompanyRecovery(email.trim());
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
    if (accessPin.trim().length < 4) {
      setError("Company PIN must be at least 4 characters.");
      setBusy(false);
      return;
    }
    if (accessPin !== confirmAccessPin) {
      setError("Company PIN confirmation does not match.");
      setBusy(false);
      return;
    }
    try {
      const response = await resetCompanyRecovery({ token, accessPin: accessPin.trim() });
      saveCompanyContext({
        id: response.company.id,
        name: response.company.name,
        email: response.company.email,
        treasuryAddress: response.company.treasury_address ?? null
      });
      router.push(nextPath ?? "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset company PIN");
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
                <label className="form-label">New Company PIN</label>
                <input
                  className="form-input"
                  type="password"
                  value={accessPin}
                  onChange={(event) => setAccessPin(event.target.value)}
                  minLength={4}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Confirm Company PIN</label>
                <input
                  className="form-input"
                  type="password"
                  value={confirmAccessPin}
                  onChange={(event) => setConfirmAccessPin(event.target.value)}
                  minLength={4}
                  required
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Updating..." : "Reset Company PIN"}
              </button>
            </form>
          ) : (
            <form className="stack" onSubmit={handleRequest}>
              <div className="form-group">
                <label className="form-label">Registered Company Email</label>
                <input
                  className="form-input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="finance@company.com"
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

export default function CompanyRecoveryPage() {
  return (
    <Suspense fallback={<div className="stack"><PageHeader title="Recover company PIN" subtitle="Loading..." /></div>}>
      <CompanyRecoveryInner />
    </Suspense>
  );
}
