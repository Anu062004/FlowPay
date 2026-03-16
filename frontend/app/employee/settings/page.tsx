"use client";

function ToggleRow({ label, desc, defaultOn = false }: { label: string; desc: string; defaultOn?: boolean }) {
  return (
    <div className="row-between" style={{ padding: "14px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <div>
        <div className="fw-medium text-sm">{label}</div>
        <div className="text-xs text-secondary mt-1">{desc}</div>
      </div>
      <div style={{
        width: 40, height: 22, borderRadius: 11,
        background: defaultOn ? "var(--accent-500)" : "var(--gray-200)",
        position: "relative", cursor: "pointer", flexShrink: 0,
      }}>
        <div style={{
          width: 16, height: 16, borderRadius: "50%", background: "#fff",
          position: "absolute", top: 3, left: defaultOn ? 21 : 3,
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }} />
      </div>
    </div>
  );
}

export default function EmployeeSettingsPage() {
  return (
    <div className="stack-xl">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Personal account and notification preferences</p>
      </div>

      <div className="grid-2">
        {/* Profile */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Profile</div>
          </div>
          <div className="card-body">
            <div className="stack">
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 8 }}>
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: "linear-gradient(135deg, var(--primary-600), var(--accent-600))",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 20, fontWeight: 700, color: "#fff", flexShrink: 0,
                }}>JD</div>
                <div>
                  <div className="fw-semi" style={{ fontSize: "var(--text-lg)" }}>Jane Doe</div>
                  <div className="text-sm text-secondary">QA Engineer</div>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input className="form-input" defaultValue="Jane Doe" />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" defaultValue="jane@acmecorp.com" />
              </div>
              <div className="form-group">
                <label className="form-label">Preferred Name</label>
                <input className="form-input" defaultValue="Jane" />
              </div>
              <button className="btn btn-primary" style={{ alignSelf: "flex-start" }}>Save</button>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Notifications</div>
          </div>
          <div className="card-body">
            <div className="stack">
              <ToggleRow label="Salary Received"    desc="Notify when salary is disbursed to wallet" defaultOn={true} />
              <ToggleRow label="EMI Deduction"       desc="Notify when EMI is deducted from salary"   defaultOn={true} />
              <ToggleRow label="Wallet Activity"     desc="Notify on any wallet transaction"           defaultOn={false} />
              <ToggleRow label="Loan Updates"        desc="Notify on loan status changes"              defaultOn={true} />
              <ToggleRow label="Monthly Summary"     desc="Receive monthly financial report email"     defaultOn={true} />
            </div>
          </div>
        </div>

        {/* Security */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Security</div>
          </div>
          <div className="card-body">
            <div className="stack">
              <ToggleRow label="Two-Factor Authentication" desc="Require 2FA for withdrawals" defaultOn={true} />
              <ToggleRow label="Login Notifications"       desc="Email on new device login"   defaultOn={true} />
              <div className="form-group" style={{ marginTop: 8 }}>
                <label className="form-label">Change Password</label>
                <input className="form-input" type="password" placeholder="Current password" />
              </div>
              <div className="form-group">
                <input className="form-input" type="password" placeholder="New password" />
              </div>
              <button className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>Update Password</button>
            </div>
          </div>
        </div>

        {/* Wallet */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Wallet Settings</div>
          </div>
          <div className="card-body">
            <div className="stack">
              <div className="form-group">
                <label className="form-label">Primary Wallet Address</label>
                <input className="form-input font-mono" defaultValue="aleo1stu9z6a2r5t4s3c…" readOnly
                  style={{ background: "var(--bg-muted)", color: "var(--text-secondary)" }} />
                <span className="form-hint">Wallet address is set by your employer and cannot be changed here.</span>
              </div>
              <ToggleRow label="Withdrawal Confirmations" desc="Require confirmation for every withdrawal" defaultOn={true} />
              <div className="form-group">
                <label className="form-label">Default Withdrawal Limit (USD)</label>
                <input className="form-input" type="number" defaultValue="5000" />
                <span className="form-hint">Withdrawals above this limit require additional verification.</span>
              </div>
              <button className="btn btn-primary" style={{ alignSelf: "flex-start" }}>Save Wallet Settings</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
