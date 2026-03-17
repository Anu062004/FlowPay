"use client";
import { useEffect, useState } from "react";
import { useMyTransactions } from "../../lib/hooks";
import { loadEmployeeContext, type EmployeeContext } from "../../lib/companyContext";
import EmployeeSessionPrompt from "../../components/EmployeeSessionPrompt";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function fmt(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  const n = parseFloat(String(val));
  return isNaN(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Skeleton({ h = 20 }: { h?: number }) {
  return <div style={{ height: h, background: "var(--gray-100)", borderRadius: 4 }} />;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="wallet-address-copy" onClick={() => {
      navigator.clipboard.writeText(text).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }}>
      <Icon d={copied ? "M5 13l4 4L19 7" : "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"} size={14} />
    </button>
  );
}

export default function EmployeeWalletPage() {
  const [ctx, setCtx] = useState<EmployeeContext | null>(null);

  useEffect(() => {
    setCtx(loadEmployeeContext());
  }, []);
  const { data, loading } = useMyTransactions();

  const [step, setStep] = useState<"idle" | "enter" | "confirm">("idle");
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");

  // Compute approx balance from personal transaction history
  const txList = data?.transactions ?? [];
  const totalIn = txList.filter(t => t.type === "payroll" || t.type === "loan_disbursement")
    .reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalEmiOut = txList.filter(t => t.type === "emi_repayment")
    .reduce((s, t) => s + parseFloat(t.amount), 0);
  const approxBalance = Math.max(totalIn - totalEmiOut, 0);

  // Last salary
  const lastSalary = txList.find(t => t.type === "payroll");

  const walletAddress = null as string | null; // will be populated from employee profile endpoint

  if (!ctx) {
    return (
      <div className="stack-xl">
        <div className="page-header"><h1 className="page-title">My Wallet</h1></div>
        <EmployeeSessionPrompt onSet={setCtx} />
      </div>
    );
  }

  return (
    <div className="stack-xl">
      <div className="page-header">
        <h1 className="page-title">My Wallet</h1>
        <p className="page-subtitle">Personal Ethereum wallet{ctx.fullName ? ` · ${ctx.fullName}` : ""}</p>
      </div>

      {/* Wallet card */}
      <div className="wallet-card">
        <div className="wallet-card-label">Personal Wallet · Ethereum Sepolia</div>
        {loading ? (
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 32, fontWeight: 700 }}>Loading…</div>
        ) : (
          <div className="wallet-card-balance">{fmt(approxBalance)}</div>
        )}
        <div className="wallet-card-sub">Estimated balance from payroll history</div>
        <div className="wallet-card-actions">
          <button className="btn btn-accent" style={{ fontSize: 12, padding: "6px 14px" }}
            onClick={() => setStep("enter")}>
            Withdraw
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid-3">
        {[
          { label: "Total Salary Received", value: loading ? "—" : fmt(txList.filter(t => t.type === "payroll").reduce((s, t) => s + parseFloat(t.amount), 0)) },
          { label: "EMI Deducted (Total)",  value: loading ? "—" : fmt(totalEmiOut) },
          { label: "Last Salary",           value: loading ? "—" : (lastSalary ? fmt(lastSalary.amount) : "—") },
        ].map((s, i) => (
          <div key={i} className="metric-card">
            <div className="metric-card-label">{s.label}</div>
            {loading ? <Skeleton h={28} /> : (
              <div className="metric-card-value font-num" style={{ fontSize: "var(--text-3xl)" }}>{s.value}</div>
            )}
          </div>
        ))}
      </div>

      {/* Withdrawal flow */}
      {step === "enter" && (
        <div className="modal-backdrop" onClick={() => setStep("idle")}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Withdraw Funds</div>
              <button className="btn btn-ghost btn-icon" onClick={() => setStep("idle")}>
                <Icon d="M6 18L18 6M6 6l12 12" size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="stack">
                <div className="form-group">
                  <label className="form-label">Destination Wallet Address</label>
                  <input className="form-input font-mono" placeholder="aleo1…"
                    value={dest} onChange={e => setDest(e.target.value)} />
                  <span className="form-hint">Must be a valid Ethereum Sepolia address.</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Amount (USD)</label>
                  <div className="form-input-prefix">
                    <span className="form-input-prefix-symbol">$</span>
                    <input className="form-input" type="number" placeholder="0.00"
                      value={amount} onChange={e => setAmount(e.target.value)} />
                  </div>
                  <span className="form-hint">Available (estimated): {fmt(approxBalance)}</span>
                </div>
                <div className="alert alert-warning">
                  <span className="alert-icon"><Icon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" size={16} /></span>
                  <span>Withdrawals are irreversible. Always double-check the destination address.</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setStep("idle")}>Cancel</button>
              <button className="btn btn-primary" onClick={() => setStep("confirm")}
                disabled={!dest || !amount}>Continue</button>
            </div>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="modal-backdrop" onClick={() => setStep("idle")}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Confirm Withdrawal</div>
              <button className="btn btn-ghost btn-icon" onClick={() => setStep("idle")}>
                <Icon d="M6 18L18 6M6 6l12 12" size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="stack">
                {[
                  ["Amount", `${fmt(amount)}`],
                  ["Network Fee", "~$0.02"],
                  ["Net Sent", fmt(Math.max(parseFloat(amount) - 0.02, 0))],
                  ["To", `${dest.slice(0, 12)}…${dest.slice(-8)}`],
                ].map(([k, v], i) => (
                  <div key={i} className="row-between" style={{
                    padding: "10px 0", borderBottom: i < 3 ? "1px solid var(--border-subtle)" : "none"
                  }}>
                    <span className="text-sm text-secondary">{k}</span>
                    <span className="fw-semi font-mono text-sm">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setStep("enter")}>Back</button>
              <button className="btn btn-danger" onClick={() => setStep("idle")}>Confirm Withdrawal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

