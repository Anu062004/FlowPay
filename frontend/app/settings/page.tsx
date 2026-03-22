"use client";

import { useEffect, useState, type ReactNode } from "react";
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

const DEFAULT_COMPANY_TIME_ZONE = "Europe/London";

const COMPANY_TIME_ZONE_OPTIONS = [
  { value: "Europe/London", label: "London (UTC/BST)" },
  { value: "America/New_York", label: "New York (ET)" },
  { value: "America/Los_Angeles", label: "San Francisco (PT)" },
  { value: "Asia/Kolkata", label: "Mumbai (IST)" }
];

const COMPANY_TIME_ZONE_ALIASES: Record<string, string> = {
  "UTC+0 - London": "Europe/London",
  "UTC-5 - New York": "America/New_York",
  "UTC-8 - San Francisco": "America/Los_Angeles",
  "UTC+5:30 - Mumbai": "Asia/Kolkata",
  "Europe/London": "Europe/London",
  "America/New_York": "America/New_York",
  "America/Los_Angeles": "America/Los_Angeles",
  "Asia/Kolkata": "Asia/Kolkata"
};

const PAYROLL_SCHEDULE_PRESETS = [
  { value: "today", label: "Today only (test)" },
  { value: "manual", label: "Manual only" },
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

function normalizeCompanyTimeZone(value?: string | null) {
  const candidate = value?.trim();
  if (!candidate) {
    return DEFAULT_COMPANY_TIME_ZONE;
  }

  return COMPANY_TIME_ZONE_ALIASES[candidate] ?? DEFAULT_COMPANY_TIME_ZONE;
}

function companyTimeZoneLabel(value?: string | null) {
  const normalized = normalizeCompanyTimeZone(value);
  return COMPANY_TIME_ZONE_OPTIONS.find((option) => option.value === normalized)?.label ?? "London (UTC/BST)";
}

function normalizeCompanySettings(settings: CompanySettings) {
  return {
    ...settings,
    profile: {
      ...settings.profile,
      timeZone: normalizeCompanyTimeZone(settings.profile.timeZone)
    }
  };
}

function getTodayPayrollLabel(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeCompanyTimeZone(timeZone),
    day: "2-digit"
  });
  const parts = formatter.formatToParts(new Date());
  const dayValue = parts.find((part) => part.type === "day")?.value ?? "15";
  return `${toOrdinal(parseInt(dayValue, 10))} of each month`;
}

function parsePayrollSchedule(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "today only") return { preset: "today", customDay: 15 };
  if (normalized === "manual only") return { preset: "manual", customDay: 15 };
  if (normalized === "1st of each month") return { preset: "1st", customDay: 1 };
  if (normalized === "15th of each month") return { preset: "15th", customDay: 15 };
  if (normalized === "last day of month") return { preset: "last-day", customDay: 28 };

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

function SettingsSection({
  eyebrow,
  title,
  subtitle,
  badge,
  tone = "default",
  children
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  tone?: "default" | "accent" | "danger";
  children: ReactNode;
}) {
  return (
    <section className={`card settings-section settings-section-${tone}`}>
      <div className="card-header settings-section-header">
        <div className="settings-section-copy">
          <span className="settings-section-eyebrow">{eyebrow}</span>
          <div className="card-title settings-section-title">{title}</div>
          {subtitle ? <div className="card-subtitle settings-section-subtitle">{subtitle}</div> : null}
        </div>
        {badge ? <div className="settings-section-badge">{badge}</div> : null}
      </div>
      <div className="card-body settings-section-body">{children}</div>
    </section>
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
    <div className="settings-toggle-row">
      <div className="settings-toggle-copy">
        <div className="settings-toggle-label">{label}</div>
        <div className="settings-toggle-desc">{desc}</div>
      </div>
      <button
        type="button"
        className={`settings-toggle ${checked ? "is-active" : ""}`}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
      >
        <span className="settings-toggle-thumb" />
      </button>
    </div>
  );
}

function StatusCard({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="card settings-empty-card">
      <div className="card-body settings-empty-card-body">
        <div className="settings-empty-card-title">{title}</div>
        <div className="settings-empty-card-copy">{description}</div>
        {action ? <div className="settings-empty-card-actions">{action}</div> : null}
      </div>
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
      .then(({ settings }) => setSettings(normalizeCompanySettings(settings)))
      .catch((err: any) => setStatus({ type: "error", message: err?.message ?? "Failed to load settings" }))
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
    updatePayroll({ payrollDay: payrollScheduleLabel(preset, customDay ?? parsed.customDay) });
  };

  const updateSecurity = (patch: Partial<CompanySettings["security"]>) => {
    setSettings((prev) => (prev ? { ...prev, security: { ...prev.security, ...patch } } : prev));
  };

  const updateAgent = (patch: Partial<CompanySettings["agent"]>) => {
    setSettings((prev) => (prev ? { ...prev, agent: { ...prev.agent, ...patch } } : prev));
  };

  const updateWalletPolicy = (patch: Partial<CompanySettings["agent"]["walletPolicy"]>) => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            agent: { ...prev.agent, walletPolicy: { ...prev.agent.walletPolicy, ...patch } }
          }
        : prev
    );
  };

  const runPayrollNow = async (successPrefix?: string) => {
    if (!context?.id) return null;

    setPayrollRunning(true);
    try {
      const result = await runPayroll(context.id);
      setStatus({
        type: "success",
        message:
          result.processed > 0
            ? `${successPrefix ? `${successPrefix} ` : ""}Agentic payroll processed ${result.processed} employee${result.processed === 1 ? "" : "s"} for ${result.payrollMonthLabel}.`
            : `${successPrefix ? `${successPrefix} ` : ""}Agentic payroll run completed, but no unpaid employees were due for ${result.payrollMonthLabel}.`
      });
      return result;
    } catch (err: any) {
      throw new Error(err?.message ?? "Failed to run payroll today");
    } finally {
      setPayrollRunning(false);
    }
  };

  const saveAll = async (label: string, options?: { triggerTodayPayroll?: boolean }) => {
    if (!context?.id || !settings) return;
    setSaving(true);
    setStatus(null);
    try {
      const { settings: next } = await updateCompanySettings(context.id, settings);
      const normalizedSettings = normalizeCompanySettings(next);
      setSettings(normalizedSettings);
      if (context.name !== next.profile.companyName || context.email !== next.profile.companyEmail) {
        saveCompanyContext({
          id: context.id,
          name: normalizedSettings.profile.companyName,
          email: normalizedSettings.profile.companyEmail || context.email,
          treasuryAddress: context.treasuryAddress ?? null
        });
      }

      if (options?.triggerTodayPayroll) {
        try {
          await runPayrollNow(`${label} saved.`);
        } catch (err: any) {
          setStatus({
            type: "error",
            message: `${label} saved, but the immediate payroll run failed: ${err?.message ?? "Unknown payroll error"}`
          });
        }
      } else {
        setStatus({ type: "success", message: `${label} saved` });
      }
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message ?? "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  };

  const saveAccessPin = async () => {
    if (!newAccessPin.trim()) {
      setStatus({ type: "error", message: "Enter a company PIN before saving." });
      return;
    }

    setPinSaving(true);
    setStatus(null);
    try {
      await updateCompanyAccessPin(newAccessPin.trim());
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              security: { ...prev.security, accessPinConfigured: true }
            }
          : prev
      );
      setNewAccessPin("");
      setStatus({ type: "success", message: "Company PIN updated" });
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message ?? "Failed to update company PIN" });
    } finally {
      setPinSaving(false);
    }
  };

  const runPayrollToday = async () => {
    setStatus(null);
    try {
      await runPayrollNow();
    } catch (err: any) {
      setStatus({ type: "error", message: err?.message ?? "Failed to run payroll today" });
    }
  };

  const disabled = saving || loading;
  const payrollSchedule = parsePayrollSchedule(settings?.payroll.payrollDay ?? "15th of each month");
  const companyTimeZone = settings ? normalizeCompanyTimeZone(settings.profile.timeZone) : DEFAULT_COMPANY_TIME_ZONE;
  const companyTimeZoneDisplay = companyTimeZoneLabel(settings?.profile.timeZone);
  const todayPayrollLabel = settings ? getTodayPayrollLabel(companyTimeZone) : "15th of each month";

  const sectionBadges = settings
    ? {
        profile: (
          <span className="badge badge-primary">
            <span className="badge-dot" />
            {companyTimeZoneDisplay}
          </span>
        ),
        payroll: (
          <span className={`badge badge-${settings.payroll.autoProcess ? "accent" : "neutral"}`}>
            <span className="badge-dot" />
            {settings.payroll.autoProcess ? "Automation On" : "Manual Control"}
          </span>
        ),
        security: (
          <span className={`badge badge-${settings.security.accessPinConfigured ? "success" : "warning"}`}>
            <span className="badge-dot" />
            {settings.security.accessPinConfigured ? "PIN Configured" : "PIN Required"}
          </span>
        ),
        agent: (
          <span className={`badge badge-${settings.agent.enabled ? "accent" : "neutral"}`}>
            <span className="badge-dot" />
            {settings.agent.enabled ? "Agent Active" : "Agent Paused"}
          </span>
        )
      }
    : null;

  return (
    <div className="settings-page stack-xl">
      <section className="settings-hero">
        <div className="settings-hero-copy">
          <div className="settings-kicker">Workspace Controls</div>
          <div className="page-header settings-page-header">
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">
              Tighten company access, payroll automation, and OpenClaw guardrails from one clean control surface.
            </p>
          </div>
        </div>
        <div className="settings-hero-stats">
          <div className="settings-hero-stat">
            <span className="settings-hero-stat-label">Active Company</span>
            <strong>{context?.name ?? "No workspace"}</strong>
            <span>{context?.email ?? "Sign in to load company details"}</span>
          </div>
          <div className="settings-hero-stat">
            <span className="settings-hero-stat-label">Payroll Schedule</span>
            <strong>{settings?.payroll.payrollDay ?? "Unavailable"}</strong>
            <span>{settings?.payroll.autoProcess ? "Runs automatically" : "Triggered manually"}</span>
          </div>
          <div className="settings-hero-stat">
            <span className="settings-hero-stat-label">Security Posture</span>
            <strong>{settings?.security.accessPinConfigured ? "PIN Protected" : "Needs PIN"}</strong>
            <span>{settings?.security.twoFactor ? "2FA enabled" : "2FA disabled"}</span>
          </div>
          <div className="settings-hero-stat">
            <span className="settings-hero-stat-label">OpenClaw Runtime</span>
            <strong>{settings?.agent.executionSource ?? "Pending"}</strong>
            <span>{settings?.agent.enabled ? "Execution enabled" : "Execution paused"}</span>
          </div>
        </div>
      </section>

      <CompanyContextBar />

      {status ? (
        <div className={`alert ${status.type === "success" ? "alert-success" : "alert-danger"}`}>{status.message}</div>
      ) : null}

      {!context?.id ? (
        <StatusCard
          title="No company session found"
          description="Open a company workspace first, then come back here to manage settings and automation controls."
          action={
            <Link className="btn btn-primary" href="/">
              Go to landing page
            </Link>
          }
        />
      ) : loading ? (
        <StatusCard
          title="Loading settings"
          description="Fetching company profile, payroll rules, security controls, and OpenClaw runtime settings."
        />
      ) : !settings ? (
        <StatusCard
          title="Unable to load settings"
          description="The workspace is open, but the settings payload could not be loaded. Refresh once or reopen the workspace."
        />
      ) : (
        <>
          <div className="settings-layout">
            <div className="settings-column">
              <SettingsSection
                eyebrow="Profile"
                title="Company Profile"
                subtitle="Core organization details visible across treasury, payroll, and access flows."
                badge={sectionBadges?.profile}
              >
                <div className="stack-lg">
                  <div className="settings-field-grid">
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
                  </div>

                  <div className="settings-field-grid">
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
                        value={companyTimeZone}
                        onChange={(e) => updateProfile({ timeZone: e.target.value })}
                      >
                        {COMPANY_TIME_ZONE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="settings-callout">
                    <div className="settings-callout-title">Context sync</div>
                    <div className="settings-callout-copy">
                      These values feed the active company context shown across the employer workspace, so updates here
                      keep routing, notifications, and runtime labels consistent.
                    </div>
                  </div>

                  <div className="settings-section-actions">
                    <button className="btn btn-primary" onClick={() => saveAll("Company profile")} disabled={disabled}>
                      Save Changes
                    </button>
                  </div>
                </div>
              </SettingsSection>

              <SettingsSection
                eyebrow="Security"
                title="Security & Access"
                subtitle="Control authentication gates, session behavior, and audit retention."
                badge={sectionBadges?.security}
              >
                <div className="stack-lg">
                  <div className="settings-callout settings-callout-highlight">
                    <div className="settings-callout-head">
                      <div>
                        <div className="settings-callout-title">Company Dashboard PIN</div>
                        <div className="settings-callout-copy">
                          Anyone opening the employer dashboard must provide this PIN, even if they know the wallet
                          address or company ID.
                        </div>
                      </div>
                      <span className={`badge badge-${settings.security.accessPinConfigured ? "success" : "warning"}`}>
                        <span className="badge-dot" />
                        {settings.security.accessPinConfigured ? "Configured" : "Not Set"}
                      </span>
                    </div>
                    <div className="form-group">
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
                    <button className="btn btn-secondary" onClick={saveAccessPin} disabled={disabled || pinSaving}>
                      {pinSaving ? "Updating..." : "Update Company PIN"}
                    </button>
                  </div>

                  <div className="settings-toggle-group">
                    <ToggleRow
                      label="Two-Factor Authentication"
                      desc="Require 2FA for all treasury transactions."
                      checked={settings.security.twoFactor}
                      onChange={(next) => updateSecurity({ twoFactor: next })}
                    />
                    <ToggleRow
                      label="Transaction Approval"
                      desc="Require admin approval for transactions above the configured threshold."
                      checked={settings.security.transactionApproval}
                      onChange={(next) => updateSecurity({ transactionApproval: next })}
                    />
                    <ToggleRow
                      label="IP Allowlist"
                      desc="Restrict access to approved network locations."
                      checked={settings.security.ipAllowlist}
                      onChange={(next) => updateSecurity({ ipAllowlist: next })}
                    />
                    <ToggleRow
                      label="Audit Log"
                      desc="Keep a complete trail of admin actions and policy changes."
                      checked={settings.security.auditLog}
                      onChange={(next) => updateSecurity({ auditLog: next })}
                    />
                  </div>

                  <div className="settings-field-grid">
                    <div className="form-group">
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
                  </div>

                  <div className="settings-section-actions">
                    <button className="btn btn-primary" onClick={() => saveAll("Security settings")} disabled={disabled}>
                      Save Security Settings
                    </button>
                  </div>
                </div>
              </SettingsSection>
            </div>

            <div className="settings-column">
              <SettingsSection
                eyebrow="Payroll"
                title="Payroll Configuration"
                subtitle="Define schedule, currency, and the live automation controls for salary runs."
                badge={sectionBadges?.payroll}
              >
                <div className="stack-lg">
                  <div className="settings-field-grid">
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
                        {payrollSchedule.preset === "today"
                          ? `Testing shortcut: saving Today only resolves to ${todayPayrollLabel} in ${companyTimeZoneDisplay} and immediately triggers the payroll run for employees due today.`
                          : "Choose when payroll should run automatically. Use the action row below for immediate one-off runs."}
                      </span>
                    </div>
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
                  </div>

                  {payrollSchedule.preset === "custom" ? (
                    <div className="settings-field-grid">
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
                    </div>
                  ) : null}

                  <div className="settings-toggle-group">
                    <ToggleRow
                      label="Auto-process Payroll"
                      desc={`Run payroll automatically at 09:00 in ${companyTimeZoneDisplay} on the scheduled date.`}
                      checked={settings.payroll.autoProcess}
                      onChange={(next) => updatePayroll({ autoProcess: next })}
                    />
                    <ToggleRow
                      label="EMI Auto-deduction"
                      desc="Deduct approved loan EMIs before salary disbursement."
                      checked={settings.payroll.emiAutoDeduction}
                      onChange={(next) => updatePayroll({ emiAutoDeduction: next })}
                    />
                    <ToggleRow
                      label="Email Notifications"
                      desc="Send payroll confirmations to employees after processing."
                      checked={settings.payroll.emailNotifications}
                      onChange={(next) => updatePayroll({ emailNotifications: next })}
                    />
                  </div>

                  <div className="settings-callout settings-callout-action">
                    <div className="settings-callout-title">Quick Payroll Actions</div>
                    <div className="settings-callout-copy">
                      Current schedule: <strong>{settings.payroll.payrollDay}</strong>. Auto-process follows the
                      configured rule, but you can still trigger a live payroll run immediately.
                    </div>
                    <div className="settings-section-actions">
                      <button
                        className="btn btn-primary"
                        onClick={() =>
                          saveAll("Payroll settings", { triggerTodayPayroll: payrollSchedule.preset === "today" })
                        }
                        disabled={disabled || payrollRunning}
                      >
                        {saving || payrollRunning ? "Saving..." : "Save Payroll Settings"}
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
              </SettingsSection>

              <SettingsSection
                eyebrow="OpenClaw"
                title="Agent Runtime & Wallet Guardrails"
                subtitle="Define how autonomous execution starts, how policy limits apply, and when human review steps in."
                badge={sectionBadges?.agent}
                tone="accent"
              >
                <div className="stack-lg">
                  <div className="settings-callout settings-callout-highlight">
                    <div className="settings-callout-title">Runtime note</div>
                    <div className="settings-callout-copy">
                      This prototype runs on ETH Sepolia today. The OpenClaw orchestration path, FlowPay policy engine,
                      and WDK execution layer are kept visible here so the settings surface mirrors the actual control
                      plane.
                    </div>
                  </div>

                  <div className="settings-field-grid">
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
                      <span className="form-hint">
                        Shown in the audit trail so the runtime path is explicit from strategy to policy validation to
                        WDK execution.
                      </span>
                    </div>
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
                  </div>

                  <div className="settings-toggle-group">
                    <ToggleRow
                      label="Agent Enabled"
                      desc="Permit OpenClaw to execute approved autonomous actions."
                      checked={settings.agent.enabled}
                      onChange={(next) => updateAgent({ enabled: next })}
                    />
                    <ToggleRow
                      label="Slippage Protection"
                      desc="Auto-cancel trades that breach the slippage threshold."
                      checked={settings.agent.slippageProtection}
                      onChange={(next) => updateAgent({ slippageProtection: next })}
                    />
                  </div>

                  <div className="settings-subsection">
                    <div className="settings-subsection-title">Wallet Permissions</div>
                    <div className="settings-toggle-group">
                      <ToggleRow
                        label="Allow Treasury Allocation"
                        desc="Permit treasury allocation after new deposits land."
                        checked={settings.agent.walletPolicy.allowTreasuryAllocation}
                        onChange={(next) => updateWalletPolicy({ allowTreasuryAllocation: next })}
                      />
                      <ToggleRow
                        label="Allow Loan Disbursal"
                        desc="Permit treasury transfers into employee wallets for approved loans."
                        checked={settings.agent.walletPolicy.allowLoanDisbursal}
                        onChange={(next) => updateWalletPolicy({ allowLoanDisbursal: next })}
                      />
                      <ToggleRow
                        label="Allow Payroll Execution"
                        desc="Permit automated payroll payouts and EMI deductions."
                        checked={settings.agent.walletPolicy.allowPayroll}
                        onChange={(next) => updateWalletPolicy({ allowPayroll: next })}
                      />
                      <ToggleRow
                        label="Allow Aave Rebalance"
                        desc="Permit automated Aave deposits and reserve rebalancing."
                        checked={settings.agent.walletPolicy.allowAaveRebalance}
                        onChange={(next) => updateWalletPolicy({ allowAaveRebalance: next })}
                      />
                    </div>
                  </div>

                  <div className="settings-subsection">
                    <div className="settings-subsection-title">Hard Limits</div>
                    <div className="settings-limit-grid">
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
                      <div className="form-group settings-limit-grid-full">
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
                        <span className="form-hint">
                          Requests above this amount still pass policy validation, but surface as human review in the
                          audit trail.
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="settings-field-grid">
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
                  </div>

                  <div className="settings-section-actions">
                    <button className="btn btn-primary" onClick={() => saveAll("Agent settings")} disabled={disabled}>
                      Update Agent Config
                    </button>
                  </div>
                </div>
              </SettingsSection>
            </div>
          </div>

          <SettingsSection
            eyebrow="Danger Zone"
            title="Irreversible Controls"
            subtitle="These actions stay visible for completeness, but remain protected and disabled in the current build."
            tone="danger"
          >
            <div className="settings-danger-list">
              <div className="settings-danger-row">
                <div>
                  <div className="settings-danger-title">Pause All Payroll</div>
                  <div className="settings-danger-copy">Temporarily halt all automated salary disbursements.</div>
                </div>
                <button className="btn btn-danger btn-sm" disabled>
                  Pause Payroll
                </button>
              </div>
              <div className="settings-danger-row">
                <div>
                  <div className="settings-danger-title">Disable AI Agent</div>
                  <div className="settings-danger-copy">Stop autonomous lending and treasury actions immediately.</div>
                </div>
                <button className="btn btn-danger btn-sm" disabled>
                  Disable Agent
                </button>
              </div>
              <div className="settings-danger-row">
                <div>
                  <div className="settings-danger-title">Close Account</div>
                  <div className="settings-danger-copy">Permanently close the FlowPay organization account.</div>
                </div>
                <button className="btn btn-danger btn-sm" disabled>
                  Close Account
                </button>
              </div>
            </div>
          </SettingsSection>
        </>
      )}
    </div>
  );
}
