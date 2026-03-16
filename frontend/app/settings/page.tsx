"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CompanyContextBar from "../components/CompanyContextBar";
import { loadCompanyContext, saveCompanyContext, type CompanyContext } from "../lib/companyContext";
import { fetchCompanySettings, updateCompanySettings, type CompanySettings } from "../lib/api";

type Status = { type: "success" | "error"; message: string } | null;

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

  const updateSecurity = (patch: Partial<CompanySettings["security"]>) => {
    setSettings((prev) => (prev ? { ...prev, security: { ...prev.security, ...patch } } : prev));
  };

  const updateAgent = (patch: Partial<CompanySettings["agent"]>) => {
    setSettings((prev) => (prev ? { ...prev, agent: { ...prev.agent, ...patch } } : prev));
  };

  const saveAll = async (label: string) => {
    if (!context?.id || !settings) return;
    setSaving(true);
    setStatus(null);
    try {
      const { settings: next } = await updateCompanySettings(context.id, settings);
      setSettings(next);
      if (context.name !== next.profile.companyName) {
        saveCompanyContext({
          id: context.id,
          name: next.profile.companyName,
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
                  <label className="form-label">Payroll Day</label>
                  <select
                    className="form-select"
                    value={settings.payroll.payrollDay}
                    onChange={(e) => updatePayroll({ payrollDay: e.target.value })}
                  >
                    <option>15th of each month</option>
                    <option>1st of each month</option>
                    <option>Last day of month</option>
                    <option>Bi-weekly</option>
                  </select>
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
                <button
                  className="btn btn-primary"
                  style={{ alignSelf: "flex-start", marginTop: 8 }}
                  onClick={() => saveAll("Payroll settings")}
                  disabled={disabled}
                >
                  Save Payroll Settings
                </button>
              </div>
            </Section>

            <Section title="Security" subtitle="Authentication and access controls">
              <div className="stack">
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

            <Section title="AI Investment Agent" subtitle="Configure autonomous capital management">
              <div className="stack">
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
