"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchCompany, fetchEmployee, registerCompany } from "./lib/api";
import { saveCompanyContext, saveEmployeeContext } from "./lib/companyContext";

type Status = { type: "success" | "error"; message: string } | null;

export default function LandingPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!companyName.trim()) {
      setStatus({ type: "error", message: "Company name is required." });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const data = await registerCompany(companyName.trim());
      saveCompanyContext({ id: data.id, name: data.name, treasuryAddress: null });
      setStatus({ type: "success", message: `Company created. ID: ${data.id}` });
      router.push("/dashboard");
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message ?? "Failed to register company" });
    } finally {
      setBusy(false);
    }
  };

  const handleCompanyLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!companyId.trim()) {
      setStatus({ type: "error", message: "Company ID is required." });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const company = await fetchCompany(companyId.trim());
      saveCompanyContext({
        id: company.id,
        name: company.name,
        treasuryAddress: company.treasury_address ?? null
      });
      router.push("/dashboard");
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message ?? "Invalid company ID" });
    } finally {
      setBusy(false);
    }
  };

  const handleEmployeeLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!employeeId.trim()) {
      setStatus({ type: "error", message: "Employee ID is required." });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const employee = await fetchEmployee(employeeId.trim());
      saveEmployeeContext({
        id: employee.id,
        fullName: employee.full_name ?? undefined,
        companyId: employee.company_id ?? undefined
      });
      router.push("/employee/overview");
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message ?? "Invalid employee ID" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }} className="stack-xl">
      <div className="page-header">
        <h1 className="page-title">FlowPay</h1>
        <p className="page-subtitle">AI-driven treasury and payroll infrastructure for modern businesses.</p>
      </div>

      {status ? (
        <div className={`alert ${status.type === "success" ? "alert-success" : "alert-danger"}`}>
          {status.message}
        </div>
      ) : null}

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Company Access</div>
              <div className="card-subtitle">Register a new company or log in with your ID.</div>
            </div>
          </div>
          <div className="card-body">
            <form className="stack" onSubmit={handleRegister}>
              <div className="form-group">
                <label className="form-label">Company Name</label>
                <input className="form-input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy}>Register Company</button>
            </form>
            <div className="divider" />
            <form className="stack" onSubmit={handleCompanyLogin}>
              <div className="form-group">
                <label className="form-label">Company ID</label>
                <input className="form-input font-mono" value={companyId} onChange={(e) => setCompanyId(e.target.value)} />
              </div>
              <button className="btn btn-secondary" type="submit" disabled={busy}>Login with Company ID</button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Employee Access</div>
              <div className="card-subtitle">Log in using the employee ID from your invite.</div>
            </div>
          </div>
          <div className="card-body">
            <form className="stack" onSubmit={handleEmployeeLogin}>
              <div className="form-group">
                <label className="form-label">Employee ID</label>
                <input className="form-input font-mono" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy}>Login to Employee Portal</button>
            </form>
            <div className="divider" />
            <div className="stack">
              <div className="text-sm text-secondary">Need to activate your account?</div>
              <Link className="btn btn-ghost" href="/employees/activate">Activate Employee Account</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
