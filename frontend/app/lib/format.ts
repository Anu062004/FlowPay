export function formatEth(
  value: string | number | null | undefined,
  maxDecimals = 6,
  symbol = "ETH"
) {
  if (value === null || value === undefined) return "--";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return "--";
  return `${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDecimals
  })} ${symbol}`;
}
