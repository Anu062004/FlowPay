"use client";

import { useState } from "react";
import Link from "next/link";
import { saveEmployeeContext, type EmployeeContext } from "../lib/companyContext";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EmployeeSessionPrompt({ onSet }: { onSet: (ctx: EmployeeContext) => void }) {
  const [employeeId, setEmployeeId] = useState("");
  const [fullName, setFullName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSet = () => {
    const id = employeeId.trim();
    if (!uuidRegex.test(id)) {
      setError("Please enter a valid Employee ID (UUID format).");
      return;
    }
    const ctx: EmployeeContext = {
      id,
      fullName: fullName.trim() || undefined,
      companyId: companyId.trim() || undefined
    };
    saveEmployeeContext(ctx);
    onSet(ctx);
    setError(null);
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Employee Session Required</div>
      </div>
      <div className="card-body">
        <div className="stack">
          <div className="text-sm text-secondary">
            Use the Employee ID from your employer or activate your account first.
          </div>
          <div className="form-group">
            <label className="form-label">Employee ID</label>
            <input className="form-input font-mono" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Full Name (optional)</label>
            <input className="form-input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Company ID (optional)</label>
            <input className="form-input font-mono" value={companyId} onChange={(e) => setCompanyId(e.target.value)} />
          </div>
          {error ? <div className="text-sm" style={{ color: "var(--danger)" }}>{error}</div> : null}
          <div className="row" style={{ gap: 12 }}>
            <button className="btn btn-primary" onClick={handleSet}>Set Employee Session</button>
            <Link className="btn btn-secondary" href="/employees/activate">Activate Account</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
