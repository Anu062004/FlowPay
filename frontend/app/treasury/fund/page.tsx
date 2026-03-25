"use client";

import { useEffect, useState } from "react";
import { apiFetch, type TreasuryBalance } from "../../lib/api";
import { PageHeader } from "../../components/PageHeader";
import { loadCompanyContext } from "../../lib/companyContext";
import { getSettlementCurrencyLabel, getSettlementNetworkLabel, normalizeSettlementChain } from "../../lib/settlement";

export default function TreasuryFundPage() {
  const [companyId, setCompanyId] = useState("");
  const [treasury, setTreasury] = useState<TreasuryBalance | null>(null);
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
      const data = await apiFetch<TreasuryBalance>(`/treasury/balance?companyId=${trimmed}`);
      setTreasury(data);
    } catch (err: any) {
      setError(err.message ?? "Failed to load treasury");
    }
  };

  const copyAddress = async () => {
    if (!treasury?.wallet_address) return;
    await navigator.clipboard.writeText(treasury.wallet_address);
    setMessage("Treasury address copied");
  };

  const treasuryChain = normalizeSettlementChain(treasury?.chain, "ethereum");
  const settlementCurrencyLabel = getSettlementCurrencyLabel(treasuryChain);
  const settlementNetworkLabel = getSettlementNetworkLabel(treasuryChain);

  return (
    <div className="stack">
      <PageHeader
        title="Treasury Funding"
        subtitle={`Send ${settlementCurrencyLabel} to fund the company treasury.`}
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
              <div>{treasury.wallet_address}</div>
            </div>
            <button className="secondary" onClick={copyAddress}>
              Copy Wallet Address
            </button>
          </div>
          <div className="notice">
            Send {settlementCurrencyLabel} to this address. Balance updates after on-chain confirmation on {settlementNetworkLabel}.
          </div>
          <div className="row">
            <div>
              <div className="label">Current Balance</div>
              <div style={{ fontWeight: 600 }}>{treasury.balance} {treasury.token_symbol}</div>
            </div>
            <button onClick={loadTreasury}>Refresh Balance</button>
          </div>
          {message ? <div className="label">{message}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
