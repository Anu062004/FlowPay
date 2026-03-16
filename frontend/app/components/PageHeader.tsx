export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="header">
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  );
}
