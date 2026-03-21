"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CompanyContextBar from "../components/CompanyContextBar";
import { loadCompanyContext, saveCompanyContext, type CompanyContext } from "../lib/companyContext";
import {
  fetchCompanySettings,
  runPayroll,
  updateCompanyAccessPin,
  updateCompanySettings,
  type CompanySettings
} from "../lib/api";

type Status = { type: "success" | "error"; message: string } | null;

const PAYROLL_SCHEDULE_PRESETS = [
  { value: "today", label: "Today only" },
  { value: "manual", label: "Manual only" },
  { value: "weekly", label: "Weekly" },
  { value: "bi-weekly", label: "Bi-weekly" },
  { value: "1st", label: "1st of each month" },
  { value: "15th", label: "15th of each month" },
  { value: "last-day", label: "Last day of month" },
  { value: "custom", label: "Custom day of month" }
];

function toOrdinal(day: number) {
  const mod10 = day % 10;
  const mod100 = day % 100;
  if (mod10 === 1 && mod100 !== 11) return `${day}st`;
  if (mod10 === 2 && mod100 !== 12) return `${day}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${day}rd`;
  return `${day}th`;
}

function parsePayrollSchedule(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "today only") {
    return { preset: "today", customDay: 15 };
  }
  if (normalized === "manual only") {
    return { preset: "manual", customDay: 15 };
  }
  if (normalized === "weekly") {
    return { preset: "weekly", customDay: 15 };
  }
  if (normalized === "bi-weekly") {
    return { preset: "bi-weekly", customDay: 15 };
  }
  if (normalized === "1st of each month") {
    return { preset: "1st", customDay: 1 };
  }
  if (normalized === "15th of each month") {
    return { preset: "15th", customDay: 15 };
  }
  if (normalized === "last day of month") {
    return { preset: "last-day", customDay: 28 };
  }

  const customMatch = value.match(/(\d+)(st|nd|rd|th) of each month/i);
  if (customMatch) {
    return { preset: "custom", customDay: Math.min(Math.max(parseInt(customMatch[1], 10), 1), 28) };
  }

  return { preset: "15th", customDay: 15 };
}

function payrollScheduleLabel(preset: string, customDay: number) {
  switch (preset) {
    case "today":
      return "Today only";
    case "manual":
      return "Manual only";
    case "weekly":
      return "Weekly";
    case "bi-weekly":
      return "Bi-weekly";
    case "1st":
      return "1st of each month";
    case "15th":
      return "15th of each month";
    case "last-day":
      return "Last day of month";
    case "custom":
      return `${toOrdinal(customDay)} of each month`;
    default:
      return "15th of each month";
  }
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">{title}</div>
          {subtitle && <div className="card-subtitle">{subtitle}</div>}
        </div>
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="row-between" style={{ padding: "14px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <div>
        <div className="fw-medium text-sm">{label}</div>
        <div className="text-xs text-secondary mt-1">{desc}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        style={{
          width: 40,
          height: 22,
          borderRadius: 11,
          background: checked ? "var(--accent-500)" : "var(--gray-200)",
          position: "relative",
          cursor: "pointer",
          flexShrink: 0,
          border: "none",
          padding: 0
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff",
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            transition: "left 0.2s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)"
          }}
        />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const [context, setContext] = useState<CompanyContext | null>(null);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pinSaving, setPinSaving] = useState(false);
  const [payrollRunning, setPayrollRunning] = useState(false);
  const [newAccessPin, setNewAccessPin] = useState("");
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    const ctx = loadCompanyContext();
    setContext(ctx);
    if (!ctx?.id) {
      setLoading(false);
      return;
    }

    fetchCompanySettings(ctx.id)
      .then(({ settings }) => setSettings(settings))
      .catch((err: any) => {
        setStatus({ type: "error", message: err?.message ?? "Failed to load settings" });
      })
      .finally(() => setLoading(false));
  }, []);

  const updateProfile = (patch: Partial<CompanySettings["profile"]>) => {
    setSettings((prev) => (prev ? { ...prev, profile: { ...prev.profile, ...patch } } : prev));
  };

  const updatePayroll = (patch: Partial<CompanySettings["payroll"]>) => {
    setSettings((prev) => (prev ? { ...prev, payroll: { ...prev.payroll, ...patch } } : prev));
  };

  const applyPayrollSchedule = (preset: string, customDay?: number) => {
    const existing = settings?.payroll.payrollDay ?? "15th of each month";
    const parsed = parsePayrollSchedule(existing);
    const nextCustomDay = customDay ?? parsed.customDay;
    updatePayroll({ payrollDay: payrollScheduleLabel(preset, nextCustomDay) });
  };

  const updateSecurity = (patch: Partial<CompanySettings["security"]>) => {
    setSettings((prev) => (prev ? { ...prev, security: { ...prev.security, ...patch } } : prev));
  };

  const updateAgent = (patch: Partial<CompanySettings["agent"]>) => {
    setSettings((prev) => (prev ? { ...prev, agent: { ...prev.agent, ...patch } } : prev));
  };

  const updateWalletPolicy = (patch: Partial<CompanySettings["agent"]["walletPolicy"]>) => {
    setSettings((prev) => (
      prev
        ? {
            ...prev,
            agent: {
              ...prev.agent,
              walletPolicy: {
                ...prev.agent.walletPolicy,
                ...patch
              }
            }
          }
        : prev
    ));
  };

  const saveAll = async (label: string) => {
    if (!context?.id || !settings) return;
    setSaving(true);
    setStatus(null);
    try {
      const { settings: next } = await updateCompanySettings(context.id, settings);
      setSettings(next);
      if (context.name !== next.profile.companyName || context.email !== next.profile.companyEmail) {
        saveCompanyContext({
          id: context.id,
          name: next.profile.companyName,
          email: next.profile.companyEmail || context.email,
          treasuryAddress: context.treasuryAddress ?? null
        });
      }
      setStatus({ type: "success", message: `${label} saved` });
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message ?? "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  };

  const disabled = saving || loading;
  const payrollSchedule = parsePayrollSchedule(settings?.payroll.payrollDay ?? "15th of each month");

  const saveAccessPin = async () => {
    if (!newAccessPin.trim()) {
      setStatus({ type: "error", message: "Enter a company PIN before saving." });
      return;
    }

    setPinSaving(true);
    setStatus(null);
    try {
      await updateCompanyAccessPin(newAccessPin.trim());
      setSettings((prev) => (
        prev
          ? {
              ...prev,
              security: {
                ...prev.security,
                accessPinConfigured: true
              }
            }
          : prev
      ));
      setNewAccessPin("");
      setStatus({ type: "success", message: "Company PIN updated" });
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message ?? "Failed to update company PIN" });
    } finally {
      setPinSaving(false);
    }
  };

  const runPayrollToday = async () => {
    if (!context?.id) return;
    setPayrollRunning(true);
    setStatus(null);
    try {
      const result = await runPayroll(context.id);
      setStatus({
        type: "success",
        message: `Payroll processed today for ${result.processed} employee${result.processed === 1 ? "" : "s"}.`
      });
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message ?? "Failed to run payroll today" });
    } finally {
      setPayrollRunning(false);
    }
  };

  return (
    <div className="stack-xl">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Company account, security, and integration preferences</p>
      </div>

      <CompanyContextBar />

      {status ? (
        <div className={`alert ${status.type === "success" ? "alert-success" : "alert-danger"}`}>
          {status.message}
        </div>
      ) : null}

      {!context?.id ? (
        <div className="card">
          <div className="card-body">
            <div className="stack">
              <div className="text-sm text-secondary">No company session found.</div>
              <Link className="btn btn-primary" href="/">Go to landing page</Link>
            </div>
          </div>
        </div>
      ) : loading ? (
        <div className="card">
          <div className="card-body">Loading settings...</div>
        </div>
      ) : !settings ? (
        <div className="card">
          <div className="card-body">Unable to load settings.</div>
        </div>
      ) : (
        <>
          <div className="grid-2">
            <Section title="Company Profile" subtitle="Organization information">
              <div className="stack">
                <div className="form-group">
                  <label className="form-label">Company Name</label>
                  <input
                    className="form-input"
                    value={settings.profile.companyName}
                    onChange={(e) => updateProfile({ companyName: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Legal Entity</label>
                  <input
                    className="form-input"
                    value={settings.profile.legalEntity}
                    onChange={(e) => updateProfile({ legalEntity: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Company Email</label>
                  <input
                    className="form-input"
                    type="email"
                    value={settings.profile.companyEmail}
                    onChange={(e) => updateProfile({ companyEmail: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Time Zone</label>
                  <select
                    className="form-select"
                    value={settings.profile.timeZone}
                    onChange={(e) => updateProfile({ timeZone: e.target.value })}
                  >
                    <option>UTC+0 - London</option>
                    <option>UTC-5 - New York</option>
                    <option>UTC-8 - San Francisco</option>
                    <option>UTC+5:30 - Mumbai</option>
                  </select>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => saveAll("Company profile")}
                  disabled={disabled}
                >
                  Save Changes
                </button>
              </div>
            </Section>

            <Section title="Payroll Configuration" subtitle="Automation and schedule settings">
              <div className="stack">
                <div className="form-group">
                  <label className="form-label">Payroll Schedule</label>
                  <select
                    className="form-select"
                    value={payrollSchedule.preset}
                    onChange={(e) => applyPayrollSchedule(e.target.value)}
                  >
                    {PAYROLL_SCHEDULE_PRESETS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="form-hint">
                    Choose when payroll should normally be processed. Use the action below if you want to run it today immediately.
                  </span>
                </div>
                {payrollSchedule.preset === "custom" ? (
                  <div className="form-group">
                    <label className="form-label">Custom Day of Month</label>
                    <select
                      className="form-select"
                      value={String(payrollSchedule.customDay)}
                      onChange={(e) => applyPayrollSchedule("custom", Number(e.target.value))}
                    >
                      {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                        <option key={day} value={day}>
                          {toOrdinal(day)} of each month
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div className="form-group">
                  <label className="form-label">Default Currency</label>
                  <select
                    className="form-select"
                    value={settings.payroll.currency}
                    onChange={(e) => updatePayroll({ currency: e.target.value })}
                  >
                    <option>USDC</option>
                    <option>Native ETH</option>
                  </select>
                </div>
                <ToggleRow
                  label="Auto-process Payroll"
                  desc="Automatically disburse salaries on scheduled date"
                  checked={settings.payroll.autoProcess}
                  onChange={(next) => updatePayroll({ autoProcess: next })}
                />
                <ToggleRow
                  label="EMI Auto-deduction"
                  desc="Deduct loan EMIs from salary before disbursement"
                  checked={settings.payroll.emiAutoDeduction}
                  onChange={(next) => updatePayroll({ emiAutoDeduction: next })}
                />
                <ToggleRow
                  label="Email Notifications"
                  desc="Send payroll confirmation emails to employees"
                  checked={settings.payroll.emailNotifications}
                  onChange={(next) => updatePayroll({ emailNotifications: next })}
                />
                <div
                  style={{
                    padding: 16,
                    borderRadius: 16,
                    background: "var(--bg-muted)",
                    border: "1px solid var(--border-subtle)"
                  }}
                  className="stack"
                >
                  <div className="fw-medium text-sm">Quick Payroll Actions</div>
                  <div className="text-xs text-secondary">
                    Current schedule: <strong>{settings.payroll.payrollDay}</strong>. You can also bypass the schedule and process payroll immediately for today.
                  </div>
                  <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => saveAll("Payroll settings")}
                      disabled={disabled}
                    >
                      Save Payroll Settings
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={runPayrollToday}
                      disabled={disabled || payrollRunning}
                    >
                      {payrollRunning ? "Running Payroll..." : "Run Payroll Today"}
                    </button>
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Security" subtitle="Authentication and access controls">
              <div className="stack">
                <div
                  style={{
                    padding: 16,
                    borderRadius: 16,
                    background: "var(--bg-muted)",
                    border: "1px solid var(--border-subtle)"
                  }}
                  className="stack"
                >
                  <div className="row-between" style={{ alignItems: "flex-start" }}>
                    <div>
                      <div className="fw-medium text-sm">Company Dashboard PIN</div>
                      <div className="text-xs text-secondary mt-1">
                        Anyone opening the employer dashboard must provide this PIN, even if they know the wallet address or company ID.
                      </div>
                    </div>
                    <span className={`badge badge-${settings.security.accessPinConfigured ? "success" : "warning"}`}>
                      <span className="badge-dot" />
                      {settings.security.accessPinConfigured ? "Configured" : "Not Set"}
                    </span>
                  </div>
                  <div className="form-group" style={{ marginTop: 8 }}>
                    <label className="form-label">New Company PIN</label>
                    <input
                      className="form-input"
                      type="password"
                      value={newAccessPin}
                      onChange={(e) => setNewAccessPin(e.target.value)}
                      placeholder="Minimum 4 characters"
                      minLength={4}
                    />
                    <span className="form-hint">Set or rotate the employer access PIN.</span>
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ alignSelf: "flex-start" }}
                    onClick={saveAccessPin}
                    disabled={disabled || pinSaving}
                  >
                    {pinSaving ? "Updating..." : "Update Company PIN"}
                  </button>
                </div>
                <ToggleRow
                  label="Two-Factor Authentication"
                  desc="Require 2FA for all treasury transactions"
                  checked={settings.security.twoFactor}
                  onChange={(next) => updateSecurity({ twoFactor: next })}
                />
                <ToggleRow
                  label="Transaction Approval"
                  desc="Require admin approval for transactions above the threshold"
                  checked={settings.security.transactionApproval}
                  onChange={(next) => updateSecurity({ transactionApproval: next })}
                />
                <ToggleRow
                  label="IP Allowlist"
                  desc="Restrict access to specific IP addresses"
                  checked={settings.security.ipAllowlist}
                  onChange={(next) => updateSecurity({ ipAllowlist: next })}
                />
                <ToggleRow
                  label="Audit Log"
                  desc="Keep full audit log of all admin actions"
                  checked={settings.security.auditLog}
                  onChange={(next) => updateSecurity({ auditLog: next })}
                />
                <div className="form-group" style={{ marginTop: 8 }}>
                  <label className="form-label">Session Timeout</label>
                  <select
                    className="form-select"
                    value={settings.security.sessionTimeout}
                    onChange={(e) => updateSecurity({ sessionTimeout: e.target.value })}
                  >
                    <option>30 minutes</option>
                    <option>1 hour</option>
                    <option>4 hours</option>
                    <option>8 hours</option>
                  </select>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => saveAll("Security settings")}
                  disabled={disabled}
                >
                  Save Security Settings
                </button>
              </div>
            </Section>

            <Section title="Agent Runtime & Wallet Guardrails" subtitle="Configure OpenClaw execution and visible safety controls">
              <div className="stack">
                <div
                  style={{
                    padding: 16,
                    borderRadius: 16,
                    background: "var(--bg-muted)",
                    border: "1px solid var(--border-subtle)"
                  }}
                  className="stack"
                >
                  <div className="fw-medium text-sm">Hackathon Runtime Note</div>
                  <div className="text-xs text-secondary">
                    This prototype uses ETH on Sepolia for testnet execution today. The OpenClaw orchestration path, WDK execution layer, and wallet policies are designed so the asset rail can be swapped to production tokens later.
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Execution Source</label>
                  <select
                    className="form-select"
                    value={settings.agent.executionSource}
                    onChange={(e) => updateAgent({ executionSource: e.target.value })}
                  >
                    <option>OpenClaw EC2</option>
                    <option>Hybrid (EC2 + backend schedulers)</option>
                  </select>
                  <span className="form-hint">Displayed in the audit trail so judges can see that strategy starts on EC2 before backend policy validation and WDK execution.</span>
                </div>
                <ToggleRow
                  label="Agent Enabled"
                  desc="Allow the agent to execute trades automatically"
                  checked={settings.agent.enabled}
                  onChange={(next) => updateAgent({ enabled: next })}
                />
                <ToggleRow
                  label="Slippage Protection"
                  desc="Auto-cancel trades with more than 2% slippage"
                  checked={settings.agent.slippageProtection}
                  onChange={(next) => updateAgent({ slippageProtection: next })}
                />
                <div className="form-group">
                  <label className="form-label">Max Trade Size (USD)</label>
                  <div className="form-input-prefix">
                    <span className="form-input-prefix-symbol">$</span>
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      value={settings.agent.maxTradeSize}
                      onChange={(e) => updateAgent({ maxTradeSize: Number(e.target.value) })}
                    />
                  </div>
                  <span className="form-hint">Maximum size of a single automated trade.</span>
                </div>
                <div className="divider" />
                <div className="fw-medium text-sm">Wallet Permissions</div>
                <ToggleRow
                  label="Allow Treasury Allocation"
                  desc="Permit the agent to allocate treasury capital after deposits land."
                  checked={settings.agent.walletPolicy.allowTreasuryAllocation}
                  onChange={(next) => updateWalletPolicy({ allowTreasuryAllocation: next })}
                />
                <ToggleRow
                  label="Allow Loan Disbursal"
                  desc="Permit the agent to move treasury funds into employee wallets for approved loans."
                  checked={settings.agent.walletPolicy.allowLoanDisbursal}
                  onChange={(next) => updateWalletPolicy({ allowLoanDisbursal: next })}
                />
                <ToggleRow
                  label="Allow Payroll Execution"
                  desc="Permit automated payroll payouts and EMI auto-deduction flows."
                  checked={settings.agent.walletPolicy.allowPayroll}
                  onChange={(next) => updateWalletPolicy({ allowPayroll: next })}
                />
                <ToggleRow
                  label="Allow Aave Rebalance"
                  desc="Permit automated Aave deposits and rebalancing decisions."
                  checked={settings.agent.walletPolicy.allowAaveRebalance}
                  onChange={(next) => updateWalletPolicy({ allowAaveRebalance: next })}
                />
                <div className="divider" />
                <div className="fw-medium text-sm">Hard Limits</div>
                <div className="form-group">
                  <label className="form-label">Max Single Transfer (USD)</label>
                  <div className="form-input-prefix">
                    <span className="form-input-prefix-symbol">$</span>
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      value={settings.agent.walletPolicy.maxSingleTransfer}
                      onChange={(e) => updateWalletPolicy({ maxSingleTransfer: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Max Daily Outflow (USD)</label>
                  <div className="form-input-prefix">
                    <span className="form-input-prefix-symbol">$</span>
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      value={settings.agent.walletPolicy.maxDailyOutflow}
                      onChange={(e) => updateWalletPolicy({ maxDailyOutflow: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Max Loan Amount (USD)</label>
                  <div className="form-input-prefix">
                    <span className="form-input-prefix-symbol">$</span>
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      value={settings.agent.walletPolicy.maxLoanAmount}
                      onChange={(e) => updateWalletPolicy({ maxLoanAmount: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Max Aave Allocation (%)</label>
                  <div className="form-input-prefix">
                    <span className="form-input-prefix-symbol">%</span>
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      max={100}
                      value={settings.agent.walletPolicy.maxAaveAllocationPct}
                      onChange={(e) => updateWalletPolicy({ maxAaveAllocationPct: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Human Review Threshold (USD)</label>
                  <div className="form-input-prefix">
                    <span className="form-input-prefix-symbol">$</span>
                    <input
                      className="form-input"
                      type="number"
                      min={0}
                      value={settings.agent.walletPolicy.humanReviewAbove}
                      onChange={(e) => updateWalletPolicy({ humanReviewAbove: Number(e.target.value) })}
                    />
                  </div>
                  <span className="form-hint">Requests above this line still run through policy validation and show as review in the audit trail.</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Risk Tolerance</label>
                  <select
                    className="form-select"
                    value={settings.agent.riskTolerance}
                    onChange={(e) => updateAgent({ riskTolerance: e.target.value })}
                  >
                    <option>Conservative - 60% stable assets</option>
                    <option>Moderate - 40% stable assets</option>
                    <option>Aggressive - 20% stable assets</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Rebalance Frequency</label>
                  <select
                    className="form-select"
                    value={settings.agent.rebalanceFrequency}
                    onChange={(e) => updateAgent({ rebalanceFrequency: e.target.value })}
                  >
                    <option>Daily</option>
                    <option>Weekly</option>
                    <option>Monthly</option>
                  </select>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => saveAll("Agent settings")}
                  disabled={disabled}
                >
                  Update Agent Config
                </button>
              </div>
            </Section>
          </div>

          <div className="card" style={{ borderColor: "var(--danger-100)" }}>
            <div className="card-header">
              <div>
                <div className="card-title" style={{ color: "var(--danger-600)" }}>Danger Zone</div>
                <div className="card-subtitle">Irreversible actions - proceed with caution</div>
              </div>
            </div>
            <div className="card-body">
              <div className="row-between" style={{ padding: "12px 0" }}>
                <div>
                  <div className="fw-medium text-sm">Pause All Payroll</div>
                  <div className="text-xs text-secondary mt-1">Temporarily halt all automated salary disbursements.</div>
                </div>
                <button className="btn btn-danger btn-sm" disabled>Pause Payroll</button>
              </div>
              <div className="divider" />
              <div className="row-between" style={{ padding: "12px 0" }}>
                <div>
                  <div className="fw-medium text-sm">Disable AI Agent</div>
                  <div className="text-xs text-secondary mt-1">Stop all autonomous investment activity immediately.</div>
                </div>
                <button className="btn btn-danger btn-sm" disabled>Disable Agent</button>
              </div>
              <div className="divider" />
              <div className="row-between" style={{ padding: "12px 0 0" }}>
                <div>
                  <div className="fw-medium text-sm">Close Account</div>
                  <div className="text-xs text-secondary mt-1">Permanently close your FlowPay organization account.</div>
                </div>
                <button className="btn btn-danger btn-sm" disabled>Close Account</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
