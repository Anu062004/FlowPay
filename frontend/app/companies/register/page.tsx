"use client";

import { useState } from "react";
import { apiFetch } from "../../lib/api";
import { saveCompanyContext } from "../../lib/companyContext";
import { PageHeader } from "../../components/PageHeader";

export default function CompanyRegisterPage() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  type RegisterCompanyResponse = {
    company: { id: string; name: string };
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
        body: JSON.stringify({ name })
      });
      setResult(data);
      saveCompanyContext({
        id: data.company.id,
        name: data.company.name,
        treasuryAddress: data.treasury_wallet.wallet_address
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
        subtitle="Create a treasury wallet for your business using Tether WDK."
      />
      <form className="card stack" onSubmit={handleSubmit}>
        <label className="label">Company Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
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
              <div className="label">Treasury Address</div>
              <div>{result.treasury_wallet.wallet_address}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
