import { env } from "../config/env.js";
import { BitfinexPricingClient } from "@tetherto/wdk-pricing-bitfinex-http";
import { PricingProvider } from "@tetherto/wdk-pricing-provider";

let lastPrice: number | null = null;

type PriceSnapshot = { price: number; changePct: number; source: string };

export type MarketAsset = {
  rank: number;
  name: string;
  symbol: string;
  price: number;
  changePct24h: number;
  marketCap: number;
  volume24h: number;
};

function parseNumber(value: unknown): number | null {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(num) ? num : null;
}

function extractSeriesPrice(point: unknown): number | null {
  if (typeof point === "number") return point;
  if (Array.isArray(point)) {
    // Bitfinex candle format: [mts, open, close, high, low, volume]
    return parseNumber(point[2] ?? point[1]);
  }
  if (point && typeof point === "object") {
    const obj = point as Record<string, unknown>;
    return parseNumber(obj.close ?? obj.price ?? obj.value);
  }
  return null;
}

const pricingClient = new BitfinexPricingClient();
const pricingProvider = new PricingProvider({
  client: pricingClient,
  priceCacheDurationMs: 5 * 60 * 1000
});

export async function getEthPrice(): Promise<PriceSnapshot> {
  const price = await pricingProvider.getLastPrice("ETH", "USD");
  const end = Date.now();
  const start = end - 24 * 60 * 60 * 1000;
  let changePct = 0;
  try {
    const series = await pricingProvider.getHistoricalPrice({ from: "ETH", to: "USD", start, end });
    const first = extractSeriesPrice(series?.[0]);
    const last = extractSeriesPrice(series?.[series.length - 1]);
    if (first && last) {
      changePct = ((last - first) / first) * 100;
    }
  } catch {
    changePct = 0;
  }

  lastPrice = price;
  return { price, changePct, source: "bitfinex" };
}

export async function getCurrentPrice(symbol: string): Promise<number> {
  if (symbol.toLowerCase() === "ethereum" || symbol.toLowerCase() === "eth") {
    const { price } = await getEthPrice();
    return price;
  }
  return 0;
}

export async function get24hChange(symbol: string): Promise<number> {
  if (symbol.toLowerCase() === "ethereum" || symbol.toLowerCase() === "eth") {
    const { changePct } = await getEthPrice();
    return changePct;
  }
  return 0;
}

export async function getTopMarketCap(limit = 10): Promise<MarketAsset[]> {
  const defaultListingsUrl =
    `https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=${limit}` +
    "&sort=market_cap&sort_dir=desc&convert=USD";

  const cmcKey =
    env.CMC_API_KEY ||
    (env.PRICE_API_URL?.includes("coinmarketcap") ? env.PRICE_API_KEY : undefined);

  if (!cmcKey) {
    throw new Error("CMC API key not configured");
  }

  const url = env.CMC_LISTINGS_URL ?? defaultListingsUrl;
  const response = await fetch(url, {
    headers: { "X-CMC_PRO_API_KEY": cmcKey }
  });

  if (!response.ok) {
    throw new Error(`CMC listings request failed: ${response.status}`);
  }

  const data = await response.json();
  const rows = Array.isArray(data?.data) ? data.data : [];

  return rows.slice(0, limit).map((asset: any) => ({
    rank: parseNumber(asset?.cmc_rank ?? asset?.rank) ?? 0,
    name: String(asset?.name ?? ""),
    symbol: String(asset?.symbol ?? ""),
    price: parseNumber(asset?.quote?.USD?.price) ?? 0,
    changePct24h: parseNumber(asset?.quote?.USD?.percent_change_24h) ?? 0,
    marketCap: parseNumber(asset?.quote?.USD?.market_cap) ?? 0,
    volume24h: parseNumber(asset?.quote?.USD?.volume_24h) ?? 0
  }));
}
