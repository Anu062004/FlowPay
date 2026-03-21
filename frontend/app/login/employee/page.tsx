"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loginEmployee,
  registerEmployeeWallet,
  type Employee,
} from "../../lib/api";
import {
  clearCompanyContext,
  saveEmployeeContext,
} from "../../lib/companyContext";

type Status = { type: "success" | "error"; message: string } | null;

export default function EmployeeLoginPage() {
  const router = useRouter();
  const [employeeName, setEmployeeName] = useState("");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeePassword, setEmployeePassword] = useState("");
  const [employeeAccess, setEmployeeAccess] = useState("");
  const [employeeLoginPassword, setEmployeeLoginPassword] = useState("");
  const [employeeLoginEmail, setEmployeeLoginEmail] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const openEmployee = (employee: Employee, walletAddress?: string | null) => {
    clearCompanyContext();
    saveEmployeeContext({
      id: employee.id,
      fullName: employee.full_name ?? undefined,
      companyId: employee.company_id ?? undefined,
      companyName: employee.company_name ?? undefined,
      walletAddress: walletAddress ?? employee.wallet_address ?? null
    });
    router.push(walletAddress || employee.wallet_address ? "/employee/wallet" : "/employee/overview");
  };

  const handleCreateEmployee = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusyAction("create-employee");
    setStatus(null);
    try {
      const data = await registerEmployeeWallet({
        fullName: employeeName.trim(),
        email: employeeEmail.trim() || undefined,
        password: employeePassword
      });
      setStatus({
        type: "success",
        message: "Employee wallet created and secured. Opening employee workspace."
      });
      openEmployee(data.employee, data.wallet.wallet_address);
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message ?? "Failed to create employee wallet" });
    } finally {
      setBusyAction(null);
    }
  };

  const handleExistingEmployee = async (event: React.FormEvent) => {
    event.preventDefault();
    const access = employeeAccess.trim();
    if (!access) {
      setStatus({ type: "error", message: "Enter an employee ID or wallet address." });
      return;
    }
    if (!employeeLoginPassword) {
      setStatus({ type: "error", message: "Enter your employee password." });
      return;
    }
    setBusyAction("existing-employee");
    setStatus(null);
    try {
      const data = await loginEmployee({
        access,
        password: employeeLoginPassword,
        email: employeeLoginEmail.trim() || undefined
      });
      openEmployee(data.employee);
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message ?? "Employee sign-in failed" });
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
                  <div className="card-title">Create Employee Wallet</div>
                  <div className="card-subtitle">Enter your details and FlowPay will create a managed employee wallet protected by your password.</div>
                </div>
              </div>
              <div className="card-body">
                <form className="stack" onSubmit={handleCreateEmployee}>
                  <div className="form-group">
                    <label className="form-label">Full Name</label>
                    <input
                      className="form-input"
                      value={employeeName}
                      onChange={(e) => setEmployeeName(e.target.value)}
                      placeholder="Jane Doe"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email (optional)</label>
                    <input
                      className="form-input"
                      type="email"
                      value={employeeEmail}
                      onChange={(e) => setEmployeeEmail(e.target.value)}
                      placeholder="jane@company.com"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <input
                      className="form-input"
                      type="password"
                      value={employeePassword}
                      onChange={(e) => setEmployeePassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      minLength={8}
                      required
                    />
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={busyAction !== null}>
                    {busyAction === "create-employee" ? "Creating..." : "Create Employee Wallet"}
                  </button>
                </form>

                <div className="landing-auth-footer">
                  Creates a managed employee wallet for salary, loans, withdrawals, and repayment activity.
                </div>
              </div>
            </div>

            <div className="card landing-auth-card">
              <div className="card-header">
                <div>
                  <div className="card-title">Use Existing Employee Wallet</div>
                  <div className="card-subtitle">Enter your employee ID or wallet address, then confirm with your password.</div>
                </div>
              </div>
              <div className="card-body">
                <form className="stack" onSubmit={handleExistingEmployee}>
                  <div className="form-group">
                    <label className="form-label">Employee ID or Wallet Address</label>
                    <input
                      className="form-input font-mono"
                      value={employeeAccess}
                      onChange={(e) => setEmployeeAccess(e.target.value)}
                      placeholder="UUID or 0x..."
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <input
                      className="form-input"
                      type="password"
                      value={employeeLoginPassword}
                      onChange={(e) => setEmployeeLoginPassword(e.target.value)}
                      placeholder="Enter your password"
                      minLength={8}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Registered Email (for first password setup or recovery)</label>
                    <input
                      className="form-input"
                      type="email"
                      value={employeeLoginEmail}
                      onChange={(e) => setEmployeeLoginEmail(e.target.value)}
                      placeholder="jane@company.com"
                    />
                  </div>
                  <button className="btn btn-secondary" type="submit" disabled={busyAction !== null}>
                    {busyAction === "existing-employee" ? "Opening..." : "Open Employee Portal"}
                  </button>
                  <Link className="btn btn-ghost" href="/recover/employee">
                    Forgot employee password?
                  </Link>
                </form>

                <div className="landing-auth-footer">
                  Returning employees can use an employee ID or wallet address, but the password still gates access.
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
