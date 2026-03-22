"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { PageHeader } from "../../components/PageHeader";
import { loadCompanyContext } from "../../lib/companyContext";

export default function TreasuryFundPage() {
  const [companyId, setCompanyId] = useState("");
  const [treasury, setTreasury] = useState<any>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadCompanyContext();
    if (stored?.id) {
      setCompanyId(stored.id);
    }
  }, []);

  const loadTreasury = async () => {
    setError(null);
    setMessage(null);
    try {
      const trimmed = companyId.trim();
      if (!trimmed) {
        setError("Company ID is required");
        return;
      }
      const data = await apiFetch(`/treasury/balance?companyId=${trimmed}`);
      setTreasury(data);
    } catch (err: any) {
      setError(err.message ?? "Failed to load treasury");
    }
  };

  const copyAddress = async () => {
    if (!treasury?.walletAddress) return;
    await navigator.clipboard.writeText(treasury.walletAddress);
    setMessage("Treasury address copied");
  };

  return (
    <div className="stack">
      <PageHeader
        title="Treasury Funding"
        subtitle="Send USDT on Ethereum to fund the company treasury."
      />
      <div className="card stack">
        <label className="label">Company ID</label>
        <div className="row">
          <input value={companyId} onChange={(e) => setCompanyId(e.target.value)} />
          <button onClick={loadTreasury}>Load Treasury</button>
        </div>
        {error ? <div className="label" style={{ color: "var(--danger)" }}>{error}</div> : null}
      </div>
      {treasury ? (
        <div className="card stack">
          <h2>Treasury Wallet</h2>
          <div className="row">
            <div style={{ flex: 1 }}>
              <div className="label">Address</div>
              <div>{treasury.walletAddress}</div>
            </div>
            <button className="secondary" onClick={copyAddress}>
              Copy Wallet Address
            </button>
          </div>
          <div className="notice">
            Send USDT on Ethereum to this address. Balance updates after onchain confirmation.
          </div>
          <div className="row">
            <div>
              <div className="label">Current Balance</div>
              <div style={{ fontWeight: 600 }}>{treasury.balanceEth}</div>
            </div>
            <button onClick={loadTreasury}>Refresh Balance</button>
          </div>
          {message ? <div className="label">{message}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
