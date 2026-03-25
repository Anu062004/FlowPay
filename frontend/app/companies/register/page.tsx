"use client";

import { useState } from "react";
import { apiFetch } from "../../lib/api";
import { saveCompanyContext } from "../../lib/companyContext";
import { PageHeader } from "../../components/PageHeader";
import { getSettlementCurrencyLabel, getSettlementNetworkLabel, type SettlementChain } from "../../lib/settlement";

export default function CompanyRegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [accessPin, setAccessPin] = useState("");
  const [settlementChain, setSettlementChain] = useState<SettlementChain>("ethereum");
  const [loading, setLoading] = useState(false);
  type RegisterCompanyResponse = {
    company: { id: string; name: string; email: string; treasury_chain?: string | null };
    treasury_wallet: { wallet_address: string };
  };
  const [result, setResult] = useState<RegisterCompanyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<RegisterCompanyResponse>("/companies/register", {
        method: "POST",
        body: JSON.stringify({ name, email, accessPin, settlementChain })
      });
      setResult(data);
      saveCompanyContext({
        id: data.company.id,
        name: data.company.name,
        email: data.company.email,
        treasuryAddress: data.treasury_wallet.wallet_address,
        treasuryChain: data.company.treasury_chain ?? settlementChain
      });
    } catch (err: any) {
      setError(err.message ?? "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title="Register Company"
        subtitle="Create a treasury wallet for your business using Tether WDK and protect it with a company PIN."
      />
      <form className="card stack" onSubmit={handleSubmit}>
        <label className="label">Company Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
        <label className="label">Work Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label className="label">Company PIN</label>
        <input type="password" value={accessPin} onChange={(e) => setAccessPin(e.target.value)} minLength={4} required />
        <label className="label">Settlement Network</label>
        <select value={settlementChain} onChange={(e) => setSettlementChain(e.target.value as SettlementChain)}>
          <option value="ethereum">{getSettlementNetworkLabel("ethereum")} · {getSettlementCurrencyLabel("ethereum")}</option>
          <option value="polygon">{getSettlementNetworkLabel("polygon")} · {getSettlementCurrencyLabel("polygon")}</option>
        </select>
        <button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create Treasury Wallet"}
        </button>
        {error ? <div className="label" style={{ color: "var(--danger)" }}>{error}</div> : null}
      </form>
      {result ? (
        <div className="card stack">
          <h2>Company Created</h2>
          <div className="row">
            <div>
              <div className="label">Company ID</div>
              <div>{result.company.id}</div>
            </div>
            <div>
              <div className="label">Email</div>
              <div>{result.company.email}</div>
            </div>
            <div>
              <div className="label">Treasury Address</div>
              <div>{result.treasury_wallet.wallet_address}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
