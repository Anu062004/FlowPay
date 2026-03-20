"use client";

import Link from "next/link";
export default function EmployeeSessionPrompt() {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Employee Session Required</div>
      </div>
      <div className="card-body">
        <div className="stack">
          <div className="text-sm text-secondary">
            Employee pages now require a valid sign-in session. Return to the landing page and sign in with your password.
          </div>
          <div className="row" style={{ gap: 12 }}>
            <Link className="btn btn-primary" href="/">Go to Get In</Link>
            <Link className="btn btn-secondary" href="/employees/activate">Activate Account</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
