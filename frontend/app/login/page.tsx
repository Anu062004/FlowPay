"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  loginCompany,
  registerCompany,
  type Company,
} from "../lib/api";
import {
  clearEmployeeContext,
  saveCompanyContext,
} from "../lib/companyContext";

type Status = { type: "success" | "error"; message: string } | null;

function getSafeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  return value;
}

function EmployerLoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [companyName, setCompanyName] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyAccessPin, setCompanyAccessPin] = useState("");
  const [companyAccess, setCompanyAccess] = useState("");
  const [companyLoginPin, setCompanyLoginPin] = useState("");
  const [companyLoginEmail, setCompanyLoginEmail] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const nextPath = getSafeNextPath(searchParams.get("next"));

  const openCompany = (company: Company) => {
    clearEmployeeContext();
    saveCompanyContext({
      id: company.id,
      name: company.name,
      email: company.email,
      treasuryAddress: company.treasury_address ?? null
    });
    router.push(nextPath ?? "/dashboard");
  };

  const handleCreateCompany = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusyAction("create-company");
    setStatus(null);
    try {
      const data = await registerCompany({
        name: companyName.trim(),
        email: companyEmail.trim(),
        accessPin: companyAccessPin.trim()
      });
      setStatus({
        type: "success",
        message: "Company wallet created and secured. Opening employer dashboard."
      });
      openCompany({
        ...data.company,
        treasury_address: data.treasury_wallet.wallet_address
      });
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message ?? "Failed to create company wallet" });
    } finally {
      setBusyAction(null);
    }
  };

  const handleExistingCompany = async (event: React.FormEvent) => {
    event.preventDefault();
    const access = companyAccess.trim();
    if (!access) {
      setStatus({ type: "error", message: "Enter a company ID or treasury wallet address." });
      return;
    }
    if (!companyLoginPin.trim()) {
      setStatus({ type: "error", message: "Enter your company PIN." });
      return;
    }
    setBusyAction("existing-company");
    setStatus(null);
    try {
      const data = await loginCompany({
        access,
        accessPin: companyLoginPin.trim(),
        email: companyLoginEmail.trim() || undefined
      });
      openCompany(data.company);
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message ?? "Company sign-in failed" });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="landing-shell">
      <div className="landing-shell-glow landing-shell-glow-left" />
      <div className="landing-shell-glow landing-shell-glow-right" />
      <div className="flex flex-col items-center justify-center min-h-screen py-16 px-4">
        <Link href="/" className="mb-8 font-mono text-sm tracking-widest text-[#4B6CFF] hover:text-[#F4F6FF] transition-colors">
          ← BACK TO HOME
        </Link>
        <div className="w-full max-w-5xl">
          {status ? (
            <div className={`alert ${status.type === "success" ? "alert-success" : "alert-danger"} mb-8`}>
              {status.message}
            </div>
          ) : null}

          <section className="landing-auth-grid">
            <div className="card landing-auth-card">
              <div className="card-header">
                <div>
                  <div className="card-title">Create Employer Wallet</div>
                  <div className="card-subtitle">Use your company name, work email, and a private company PIN to provision a managed treasury wallet.</div>
                </div>
              </div>
              <div className="card-body">
                <form className="stack" onSubmit={handleCreateCompany}>
                  <div className="form-group">
                    <label className="form-label">Company Name</label>
                    <input
                      className="form-input"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Acme Treasury Labs"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Work Email</label>
                    <input
                      className="form-input"
                      type="email"
                      value={companyEmail}
                      onChange={(e) => setCompanyEmail(e.target.value)}
                      placeholder="finance@acme.com"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Company PIN</label>
                    <input
                      className="form-input"
                      type="password"
                      value={companyAccessPin}
                      onChange={(e) => setCompanyAccessPin(e.target.value)}
                      placeholder="Minimum 4 characters"
                      minLength={4}
                      required
                    />
                    <span className="form-hint">This PIN is required every time someone opens the employer dashboard.</span>
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={busyAction !== null}>
                    {busyAction === "create-company" ? "Creating..." : "Create Company Wallet"}
                  </button>
                </form>

                <div className="landing-auth-footer">
                  Creates a managed treasury wallet that OpenClaw and FlowPay can operate under policy controls.
                </div>
              </div>
            </div>

            <div className="card landing-auth-card">
              <div className="card-header">
                <div>
                  <div className="card-title">Use Existing Employer Wallet</div>
                  <div className="card-subtitle">Enter your company ID or treasury wallet address, then confirm with your company PIN.</div>
                </div>
              </div>
              <div className="card-body">
                <form className="stack" onSubmit={handleExistingCompany}>
                  <div className="form-group">
                    <label className="form-label">Company ID or Wallet Address</label>
                    <input
                      className="form-input font-mono"
                      value={companyAccess}
                      onChange={(e) => setCompanyAccess(e.target.value)}
                      placeholder="UUID or 0x..."
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Company PIN</label>
                    <input
                      className="form-input"
                      type="password"
                      value={companyLoginPin}
                      onChange={(e) => setCompanyLoginPin(e.target.value)}
                      placeholder="Enter company PIN"
                      minLength={4}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Registered Email (for first PIN setup or recovery)</label>
                    <input
                      className="form-input"
                      type="email"
                      value={companyLoginEmail}
                      onChange={(e) => setCompanyLoginEmail(e.target.value)}
                      placeholder="finance@acme.com"
                    />
                  </div>
                  <button className="btn btn-secondary" type="submit" disabled={busyAction !== null}>
                    {busyAction === "existing-company" ? "Opening..." : "Open Employer Dashboard"}
                  </button>
                  <Link className="btn btn-ghost" href="/recover/company">
                    Forgot company PIN?
                  </Link>
                </form>

                <div className="landing-auth-footer">
                  Returning employers can use a company ID or treasury address, but the company PIN still gates access.
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function EmployerLoginPage() {
  return (
    <Suspense fallback={<div className="landing-shell" style={{ minHeight: "100vh" }} />}>
      <EmployerLoginInner />
    </Suspense>
  );
}
