"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loginCompany,
  loginEmployee,
  registerCompany,
  registerEmployeeWallet,
  type Company,
  type Employee
} from "./lib/api";
import {
  clearCompanyContext,
  clearEmployeeContext,
  saveCompanyContext,
  saveEmployeeContext
} from "./lib/companyContext";

type Role = "employer" | "employee";
type Status = { type: "success" | "error"; message: string } | null;

const ARCHITECTURE_LAYERS = [
  {
    step: "01",
    label: "OpenClaw on EC2",
    description: "Runs orchestration loops, triggers demo flows, and drives wallet activity without exposing raw keys to the browser.",
  },
  {
    step: "02",
    label: "FlowPay policy engine",
    description: "Validates permissions, transfer caps, approval thresholds, and wallet guardrails before any movement happens.",
  },
  {
    step: "03",
    label: "WDK wallet execution",
    description: "Creates wallets, signs treasury actions, disburses loans, runs payroll, and handles reserve top-ups.",
  },
  {
    step: "04",
    label: "On-chain settlement",
    description: "The prototype settles on Sepolia ETH today while preserving the same control path for production asset rails later.",
  },
];

const AUTOMATION_MOMENTS = [
  {
    title: "Treasury funded",
    description: "Deposits are watched automatically and pushed into treasury allocation.",
  },
  {
    title: "Agent allocates capital",
    description: "OpenClaw recommends payroll reserve, lending pool, and investment routing.",
  },
  {
    title: "Employee requests a loan",
    description: "The loan agent scores the request and WDK disburses approved funds to the employee wallet.",
  },
  {
    title: "Payroll collects EMI",
    description: "Salary runs auto-deduct EMI and update the loan state without separate manual intervention.",
  },
  {
    title: "Idle funds rebalance",
    description: "Investment flows can route surplus treasury capital to Aave while keeping operational reserves intact.",
  },
];

const CONTROL_POINTS = [
  {
    title: "Credentialed entry only",
    description: "Wallet addresses alone do not unlock dashboards. Employers use a company PIN and employees use a password.",
  },
  {
    title: "Visible agent audit trail",
    description: "Decision, policy validation, and WDK execution logs are exposed in the admin surface for review.",
  },
  {
    title: "Agent wallet guardrails",
    description: "Per-wallet permissions, review thresholds, and reserve top-up caps keep the automation bounded.",
  },
];

function roleCopy(role: Role) {
  if (role === "employer") {
    return {
      eyebrow: "Employer Environment",
      title: "Get in to your company treasury workspace",
      subtitle: "Create a Tether WDK treasury wallet and secure it with a company PIN, or sign in with your existing company ID or treasury wallet plus PIN.",
      createTitle: "Create Employer Wallet",
      createHelp: "Use your company name, work email, and a private company PIN to provision a managed treasury wallet.",
      existingTitle: "Use Existing Employer Wallet",
      existingHelp: "Enter your company ID or treasury wallet address, then confirm with your company PIN.",
      createButton: "Create Company Wallet",
      existingButton: "Open Employer Dashboard",
      note: "Wallet addresses alone no longer unlock the employer dashboard. A company PIN is required."
    };
  }

  return {
    eyebrow: "Employee Environment",
    title: "Get in to your employee wallet workspace",
    subtitle: "Create your own Tether WDK employee wallet with a password, or sign in with your existing employee ID or wallet address plus password.",
    createTitle: "Create Employee Wallet",
    createHelp: "Enter your details and FlowPay will create a managed employee wallet protected by your password.",
    existingTitle: "Use Existing Employee Wallet",
    existingHelp: "Enter your employee ID or wallet address, then confirm with your password.",
    createButton: "Create Employee Wallet",
    existingButton: "Open Employee Portal",
    note: "Wallet addresses alone no longer unlock employee pages. Activated employees must sign in with a password."
  };
}

export default function LandingPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>("employer");
  const [companyName, setCompanyName] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyAccessPin, setCompanyAccessPin] = useState("");
  const [companyAccess, setCompanyAccess] = useState("");
  const [companyLoginPin, setCompanyLoginPin] = useState("");
  const [companyLoginEmail, setCompanyLoginEmail] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeePassword, setEmployeePassword] = useState("");
  const [employeeAccess, setEmployeeAccess] = useState("");
  const [employeeLoginPassword, setEmployeeLoginPassword] = useState("");
  const [employeeLoginEmail, setEmployeeLoginEmail] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const copy = roleCopy(role);
  const supportLink = role === "employee"
    ? { href: "/employees/activate", label: "Finish Email Invite Activation" }
    : { href: "/treasury/fund", label: "Open Treasury Funding Screen" };
  const roleSignals = role === "employer"
    ? [
        { label: "Primary action", value: "Fund treasury and run payroll" },
        { label: "Access control", value: "Company PIN required" },
        { label: "Wallet scope", value: "Treasury, lending, investments" },
      ]
    : [
        { label: "Primary action", value: "Access salary wallet and loans" },
        { label: "Access control", value: "Password required" },
        { label: "Wallet scope", value: "Salary, loan, withdrawal activity" },
      ];

  const openCompany = (company: Company) => {
    clearEmployeeContext();
    saveCompanyContext({
      id: company.id,
      name: company.name,
      email: company.email,
      treasuryAddress: company.treasury_address ?? null
    });
    router.push("/dashboard");
  };

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
      <div className="landing-container stack-xl">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <div className="landing-kicker">FlowPay autonomous finance stack</div>
            <h1 className="landing-title">
              OpenClaw on EC2 drives treasury, payroll, lending, and wallet execution.
            </h1>
            <p className="landing-subtitle">
              The product surface now matches the actual system: OpenClaw handles orchestration,
              FlowPay applies policy, WDK executes wallet actions, and the prototype settles on Sepolia ETH.
            </p>

            <div className="landing-pill-row">
              <span className="landing-pill">OpenClaw orchestration</span>
              <span className="landing-pill">Policy and audit trail</span>
              <span className="landing-pill">WDK wallets</span>
              <span className="landing-pill">Sepolia ETH testnet</span>
            </div>

            <div className="landing-architecture-grid">
              {ARCHITECTURE_LAYERS.map((item) => (
                <div key={item.step} className="landing-architecture-card">
                  <div className="landing-architecture-step">{item.step}</div>
                  <div className="landing-architecture-title">{item.label}</div>
                  <div className="landing-architecture-description">{item.description}</div>
                </div>
              ))}
            </div>
          </div>

          <aside className="landing-role-panel">
            <div className="landing-role-toggle">
              <button
                type="button"
                className={`landing-role-toggle-button ${role === "employer" ? "active" : ""}`}
                onClick={() => setRole("employer")}
              >
                Employer
              </button>
              <button
                type="button"
                className={`landing-role-toggle-button ${role === "employee" ? "active" : ""}`}
                onClick={() => setRole("employee")}
              >
                Employee
              </button>
            </div>

            <div className="landing-role-summary">
              <div className="landing-role-eyebrow">{copy.eyebrow}</div>
              <div className="landing-role-title">{copy.title}</div>
              <p className="landing-role-description">{copy.subtitle}</p>
            </div>

            <div className="landing-role-signal-list">
              {roleSignals.map((signal) => (
                <div key={signal.label} className="landing-role-signal">
                  <div className="landing-role-signal-label">{signal.label}</div>
                  <div className="landing-role-signal-value">{signal.value}</div>
                </div>
              ))}
            </div>

            <div className="landing-role-note">
              <div className="landing-role-note-title">Access Note</div>
              <div className="landing-role-note-copy">{copy.note}</div>
              <Link className="btn btn-ghost" href={supportLink.href}>
                {supportLink.label}
              </Link>
            </div>
          </aside>
        </section>

        {status ? (
          <div className={`alert ${status.type === "success" ? "alert-success" : "alert-danger"}`}>
            {status.message}
          </div>
        ) : null}

        <section className="landing-auth-grid">
          <div className="card landing-auth-card">
            <div className="card-header">
              <div>
                <div className="card-title">{copy.createTitle}</div>
                <div className="card-subtitle">{copy.createHelp}</div>
              </div>
            </div>
            <div className="card-body">
              {role === "employer" ? (
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
                    {busyAction === "create-company" ? "Creating..." : copy.createButton}
                  </button>
                </form>
              ) : (
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
                    {busyAction === "create-employee" ? "Creating..." : copy.createButton}
                  </button>
                </form>
              )}

              <div className="landing-auth-footer">
                {role === "employer"
                  ? "Creates a managed treasury wallet that OpenClaw and FlowPay can operate under policy controls."
                  : "Creates a managed employee wallet for salary, loans, withdrawals, and repayment activity."}
              </div>
            </div>
          </div>

          <div className="card landing-auth-card">
            <div className="card-header">
              <div>
                <div className="card-title">{copy.existingTitle}</div>
                <div className="card-subtitle">{copy.existingHelp}</div>
              </div>
            </div>
            <div className="card-body">
              {role === "employer" ? (
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
                    {busyAction === "existing-company" ? "Opening..." : copy.existingButton}
                  </button>
                  <Link className="btn btn-ghost" href="/recover/company">
                    Forgot company PIN?
                  </Link>
                </form>
              ) : (
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
                    {busyAction === "existing-employee" ? "Opening..." : copy.existingButton}
                  </button>
                  <Link className="btn btn-ghost" href="/recover/employee">
                    Forgot employee password?
                  </Link>
                </form>
              )}

              <div className="landing-auth-footer">
                {role === "employer"
                  ? "Returning employers can use a company ID or treasury address, but the company PIN still gates access."
                  : "Returning employees can use an employee ID or wallet address, but the password still gates access."}
              </div>
            </div>
          </div>
        </section>

        <section className="landing-insight-grid">
          <div className="landing-info-card">
            <div className="landing-info-eyebrow">Automated flow</div>
            <div className="landing-info-title">What the platform automates end to end</div>
            <div className="landing-flow-list">
              {AUTOMATION_MOMENTS.map((item) => (
                <div key={item.title} className="landing-flow-item">
                  <div className="landing-flow-title">{item.title}</div>
                  <div className="landing-flow-description">{item.description}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="landing-info-card">
            <div className="landing-info-eyebrow">Control plane</div>
            <div className="landing-info-title">How the automation stays safe and visible</div>
            <div className="landing-control-list">
              {CONTROL_POINTS.map((item) => (
                <div key={item.title} className="landing-control-item">
                  <div className="landing-control-title">{item.title}</div>
                  <div className="landing-control-description">{item.description}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
