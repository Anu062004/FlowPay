"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// ── SVG Icon primitives ──────────────────────────────────────
const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const Icons = {
  overview:     "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  treasury:     "M3 10h18M7 15h.01M11 15h.01M7 3l-4 7h18l-4-7H7zM4 10v9a1 1 0 001 1h14a1 1 0 001-1v-9",
  employees:    "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  payroll:      "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  lending:      "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z",
  investments:  "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
  transactions: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
  settings:     "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  admin:        "M12 3l7 4v5c0 5-3.5 9-7 11-3.5-2-7-6-7-11V7l7-4z",
  wallet:       "M3 10h18M7 15h.01M11 15h.01M3 7h18a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1z",
  loans:        "M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z",
  bell:         "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  help:         "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  search:       "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
};

const employerNavItems = [
  { label: "Overview",     href: "/dashboard",             icon: Icons.overview },
  { label: "Treasury",     href: "/treasury",              icon: Icons.treasury },
  { label: "Employees",    href: "/employees",             icon: Icons.employees },
  { label: "Payroll",      href: "/payroll",               icon: Icons.payroll },
  { label: "Lending",      href: "/lending",               icon: Icons.lending },
  { label: "Investments",  href: "/investments",           icon: Icons.investments },
  { label: "Transactions", href: "/transactions",          icon: Icons.transactions },
  { label: "Admin Control",href: "/admin",                 icon: Icons.admin },
  { label: "Settings",     href: "/settings",              icon: Icons.settings },
];

const employeeNavItems = [
  { label: "Overview",     href: "/employee/overview",     icon: Icons.overview },
  { label: "My Wallet",    href: "/employee/wallet",       icon: Icons.wallet },
  { label: "Loans",        href: "/employee/loans",        icon: Icons.loans },
  { label: "Transactions", href: "/employee/transactions", icon: Icons.transactions },
  { label: "Settings",     href: "/employee/settings",     icon: Icons.settings },
];

const DASHBOARD_PATHS = [
  "/dashboard", "/treasury", "/employees", "/payroll",
  "/lending", "/investments", "/transactions", "/settings",
  "/admin", "/employee",
];

function isEmployee(path: string) { return path.startsWith("/employee"); }

function getTitle(path: string): { section: string; page: string } {
  const map: Record<string, string> = {
    "/dashboard":             "Employer",
    "/treasury":              "Treasury",
    "/employees":             "Employees",
    "/payroll":               "Payroll",
    "/lending":               "Lending",
    "/investments":           "Investments",
    "/transactions":          "Transactions",
    "/admin":                 "Admin Control",
    "/settings":              "Settings",
    "/employee/overview":     "My Account",
    "/employee/wallet":       "My Wallet",
    "/employee/loans":        "My Loans",
    "/employee/transactions": "My Transactions",
    "/employee/settings":     "Settings",
  };
  return { section: isEmployee(path) ? "Employee Portal" : "Employer Dashboard", page: map[path] || "Dashboard" };
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDashboard = DASHBOARD_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"));
  const emp = isEmployee(pathname);
  const navItems = emp ? employeeNavItems : employerNavItems;
  const { section, page } = getTitle(pathname);

  if (!isDashboard) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">FP</div>
          <div className="sidebar-logo-text">Flow<span>Pay</span></div>
        </div>

        {/* Mode switch */}
        <div style={{ padding: "12px 12px 0" }}>
          <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 2, gap: 2 }}>
            <Link href="/dashboard" style={{
              flex: 1, textAlign: "center", fontSize: "11px", fontWeight: 600,
              padding: "5px 0", borderRadius: 6, textDecoration: "none",
              background: !emp ? "rgba(16,185,129,0.15)" : "transparent",
              color: !emp ? "#34d399" : "#64748b", transition: "all 120ms ease",
            }}>Employer</Link>
            <Link href="/employee/overview" style={{
              flex: 1, textAlign: "center", fontSize: "11px", fontWeight: 600,
              padding: "5px 0", borderRadius: 6, textDecoration: "none",
              background: emp ? "rgba(16,185,129,0.15)" : "transparent",
              color: emp ? "#34d399" : "#64748b", transition: "all 120ms ease",
            }}>Employee</Link>
          </div>
        </div>

        {/* Nav */}
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

        {/* User footer */}
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{emp ? "JD" : "AC"}</div>
            <div>
              <div className="sidebar-user-name">{emp ? "Jane Doe" : "Acme Corp"}</div>
              <div className="sidebar-user-role">{emp ? "Employee" : "Admin"}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="main-content">
        <header className="top-header">
          <div className="header-breadcrumb">
            <span>{section}</span>
            <span className="header-breadcrumb-sep">›</span>
            <span className="header-breadcrumb-current">{page}</span>
          </div>
          <div className="header-actions">
            <div className="search-input-wrap">
              <span className="search-input-icon"><Icon d={Icons.search} size={14} /></span>
              <input className="search-input" placeholder="Search…" />
            </div>
            <div className="header-divider" />
            <div className="header-org-badge">
              <span className="header-org-dot" />Mainnet
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
