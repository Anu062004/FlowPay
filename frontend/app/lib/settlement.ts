export type SettlementChain = "ethereum" | "polygon";

export function normalizeSettlementChain(
  value?: string | null,
  fallback: SettlementChain = "ethereum"
): SettlementChain {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "polygon" || normalized === "ethereum" ? normalized : fallback;
}

export function getSettlementNetworkLabel(chain: SettlementChain) {
  return chain === "polygon" ? "Polygon" : "Ethereum";
}

export function getSettlementCurrencyLabel(chain: SettlementChain) {
  return `USDT on ${getSettlementNetworkLabel(chain)}`;
}

export function getSettlementNativeGasSymbol(chain: SettlementChain) {
  return chain === "polygon" ? "POL" : "ETH";
}

export function getSettlementNativeGasLabel(chain: SettlementChain) {
  return `native ${getSettlementNativeGasSymbol(chain)}`;
}
