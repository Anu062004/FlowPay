"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutCompany, logoutEmployee } from "./lib/api";
import {
  clearCompanyContext,
  clearEmployeeContext,
  loadCompanyContext,
  loadEmployeeContext,
  type CompanyContext,
  type EmployeeContext
} from "./lib/companyContext";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const Icons = {
  overview: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  treasury: "M3 10h18M7 15h.01M11 15h.01M7 3l-4 7h18l-4-7H7zM4 10v9a1 1 0 001 1h14a1 1 0 001-1v-9",
  employees: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  payroll: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  lending: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z",
  investments: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
  transactions: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
  settings: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  admin: "M12 3l7 4v5c0 5-3.5 9-7 11-3.5-2-7-6-7-11V7l7-4z",
  wallet: "M3 10h18M7 15h.01M11 15h.01M3 7h18a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1z",
  loans: "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z",
  bell: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  help: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  logout: "M17 16l4-4m0 0l-4-4m4 4H9M13 20H5a2 2 0 01-2-2V6a2 2 0 012-2h8"
};

const employerNavItems = [
  { label: "Overview", href: "/dashboard", icon: Icons.overview },
  { label: "Treasury", href: "/treasury", icon: Icons.treasury },
  { label: "Employees", href: "/employees", icon: Icons.employees },
  { label: "Payroll", href: "/payroll", icon: Icons.payroll },
  { label: "Lending", href: "/lending", icon: Icons.lending },
  { label: "Investments", href: "/investments", icon: Icons.investments },
  { label: "Transactions", href: "/transactions", icon: Icons.transactions },
  { label: "Admin Control", href: "/admin", icon: Icons.admin },
  { label: "Settings", href: "/settings", icon: Icons.settings }
];

const employeeNavItems = [
  { label: "Overview", href: "/employee/overview", icon: Icons.overview },
  { label: "My Wallet", href: "/employee/wallet", icon: Icons.wallet },
  { label: "Loans", href: "/employee/loans", icon: Icons.loans },
  { label: "Transactions", href: "/employee/transactions", icon: Icons.transactions },
  { label: "Settings", href: "/employee/settings", icon: Icons.settings }
];

const DASHBOARD_PATHS = [
  "/dashboard", "/treasury", "/employees", "/payroll",
  "/lending", "/investments", "/transactions", "/settings",
  "/admin", "/employee"
];

function isEmployeePath(path: string) {
  return path.startsWith("/employee");
}

function getTitle(path: string): { section: string; page: string } {
  const map: Record<string, string> = {
    "/dashboard": "Employer",
    "/treasury": "Treasury",
    "/employees": "Employees",
    "/payroll": "Payroll",
    "/lending": "Lending",
    "/investments": "Investments",
    "/transactions": "Transactions",
    "/admin": "Admin Control",
    "/settings": "Settings",
    "/employee/overview": "My Account",
    "/employee/wallet": "My Wallet",
    "/employee/loans": "My Loans",
    "/employee/transactions": "My Transactions",
    "/employee/settings": "Settings"
  };
  return {
    section: isEmployeePath(path) ? "Employee Portal" : "Employer Dashboard",
    page: map[path] || "Workspace"
  };
}

function initials(label: string) {
  return label
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "FP";
}

function shortAddress(address?: string | null) {
  if (!address) return null;
  if (address.length <= 18) return address;
  return `${address.slice(0, 10)}...${address.slice(-6)}`;
}

function SessionRequired({ employee }: { employee: boolean }) {
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f8fafc 0%, #eef4ff 100%)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "72px 24px" }} className="stack-xl">
        <div className="page-header">
          <h1 className="page-title">{employee ? "Employee session required" : "Employer session required"}</h1>
          <p className="page-subtitle">
            Return to the get-in page and open the correct workspace before using this area.
          </p>
        </div>
        <div className="card">
          <div className="card-body stack">
            <div className="text-sm text-secondary">
              {employee
                ? "This space is isolated for employee wallet sessions."
                : "This space is isolated for employer treasury sessions."}
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Link className="btn btn-primary" href="/">Go to Get In</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathnameValue = usePathname();
  const pathname = pathnameValue ?? "/";
  const router = useRouter();
  const isDashboard = DASHBOARD_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const employeeView = isEmployeePath(pathname);
  const navItems = employeeView ? employeeNavItems : employerNavItems;
  const { section, page } = getTitle(pathname);

  const [ready, setReady] = useState(false);
  const [companyCtx, setCompanyCtx] = useState<CompanyContext | null>(null);
  const [employeeCtx, setEmployeeCtx] = useState<EmployeeContext | null>(null);

  useEffect(() => {
    setCompanyCtx(loadCompanyContext());
    setEmployeeCtx(loadEmployeeContext());
    setReady(true);
  }, [pathname]);

  const activeSession = employeeView ? employeeCtx : companyCtx;
  const activeName = employeeView
    ? employeeCtx?.fullName || "Employee Wallet"
    : companyCtx?.name || "Employer Workspace";
  const activeRole = employeeView ? "Employee" : "Employer";
  const activeMeta = employeeView
    ? shortAddress(employeeCtx?.walletAddress)
    : shortAddress(companyCtx?.treasuryAddress) || companyCtx?.email || null;

  const handleLogout = async () => {
    await Promise.allSettled([logoutCompany(), logoutEmployee()]);
    clearCompanyContext();
    clearEmployeeContext();
    setCompanyCtx(null);
    setEmployeeCtx(null);
    router.push("/");
    router.refresh();
  };

  if (!isDashboard) {
    return <>{children}</>;
  }

  if (!ready) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f8fafc 0%, #eef4ff 100%)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "72px 24px" }} className="stack-xl">
          <div className="page-header">
            <h1 className="page-title">Loading workspace</h1>
            <p className="page-subtitle">Restoring your FlowPay session and workspace context.</p>
          </div>
          <div className="card">
            <div className="card-body stack">
              <div className="text-sm text-secondary">
                If this screen does not update, refresh the page once or return to the get-in screen and open the workspace again.
              </div>
              <div className="row" style={{ gap: 12 }}>
                <Link className="btn btn-primary" href="/">Go to Get In</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!activeSession) {
    return <SessionRequired employee={employeeView} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">FP</div>
          <div className="sidebar-logo-text">Flow<span>Pay</span></div>
        </div>

        <div style={{ padding: "12px 12px 0" }}>
          <div style={{
            padding: 14,
            borderRadius: 16,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.06)"
          }}>
            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b", marginBottom: 8 }}>
              Active Workspace
            </div>
            <div style={{ color: "#f8fafc", fontWeight: 700, fontSize: 14 }}>{activeRole}</div>
            <div style={{ color: "#cbd5e1", fontSize: 12, marginTop: 4 }}>{activeName}</div>
            {activeMeta ? (
              <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 8, fontFamily: "var(--font-mono)" }}>{activeMeta}</div>
            ) : null}
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href} className={`sidebar-link${active ? " active" : ""}`}>
                <span className="sidebar-link-icon"><Icon d={item.icon} size={16} /></span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{initials(activeName)}</div>
            <div>
              <div className="sidebar-user-name">{activeName}</div>
              <div className="sidebar-user-role">{activeRole}</div>
            </div>
          </div>
          <Link className="sidebar-link" href="/" style={{ marginTop: 8 }}>
            <span className="sidebar-link-icon"><Icon d={Icons.overview} size={16} /></span>
            Back to Get In
          </Link>
          <button className="sidebar-link" type="button" onClick={handleLogout} style={{ marginTop: 8 }}>
            <span className="sidebar-link-icon"><Icon d={Icons.logout} size={16} /></span>
            Leave Workspace
          </button>
        </div>
      </aside>

      <div className="main-content">
        <header className="top-header">
          <div className="header-breadcrumb">
            <span>{section}</span>
            <span className="header-breadcrumb-sep">&gt;</span>
            <span className="header-breadcrumb-current">{page}</span>
          </div>
          <div className="header-actions">
            <div className="search-input-wrap">
              <span className="search-input-icon"><Icon d={Icons.search} size={14} /></span>
              <input className="search-input" placeholder={`Search ${activeRole.toLowerCase()} workspace...`} />
            </div>
            <div className="header-divider" />
            <div className="header-org-badge">
              <span className="header-org-dot" />Managed WDK
            </div>
            <button className="header-icon-btn" title="Notifications"><Icon d={Icons.bell} size={15} /></button>
            <button className="header-icon-btn" title="Help"><Icon d={Icons.help} size={15} /></button>
          </div>
        </header>
        <div className="page-body">{children}</div>
      </div>
    </div>
  );
}
