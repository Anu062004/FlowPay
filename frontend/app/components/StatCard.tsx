export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
      {hint ? <div className="label">{hint}</div> : null}
    </div>
  );
}
