import { env } from "../config/env.js";
import { BitfinexPricingClient } from "@tetherto/wdk-pricing-bitfinex-http";
import { PricingProvider } from "@tetherto/wdk-pricing-provider";

let lastPrice: number | null = null;
let marketBoardCache: { expiresAt: number; data: MarketBoard } | null = null;

const MARKET_BOARD_TTL_MS = 30 * 1000;

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

type MarketCategory = "crypto" | "metal";

type MarketCatalogEntry = {
  rank: number;
  name: string;
  symbol: string;
  category: MarketCategory;
};

export type TrackedMarketAsset = {
  rank: number;
  name: string;
  symbol: string;
  category: MarketCategory;
  price: number | null;
  changePct24h: number | null;
  source: string;
  available: boolean;
};

export type MarketBoard = {
  updatedAt: string;
  pricingSource: string;
  rankingSource: "cmc" | "curated";
  crypto: TrackedMarketAsset[];
  metals: TrackedMarketAsset[];
};

const CURATED_CRYPTO_ASSETS: MarketCatalogEntry[] = [
  { rank: 1, name: "Bitcoin", symbol: "BTC", category: "crypto" },
  { rank: 2, name: "Ethereum", symbol: "ETH", category: "crypto" },
  { rank: 3, name: "XRP", symbol: "XRP", category: "crypto" },
  { rank: 4, name: "BNB", symbol: "BNB", category: "crypto" },
  { rank: 5, name: "Solana", symbol: "SOL", category: "crypto" },
  { rank: 6, name: "Dogecoin", symbol: "DOGE", category: "crypto" },
  { rank: 7, name: "Cardano", symbol: "ADA", category: "crypto" },
  { rank: 8, name: "TRON", symbol: "TRX", category: "crypto" },
  { rank: 9, name: "Avalanche", symbol: "AVAX", category: "crypto" },
  { rank: 10, name: "Chainlink", symbol: "LINK", category: "crypto" },
  { rank: 11, name: "Toncoin", symbol: "TON", category: "crypto" },
  { rank: 12, name: "Stellar", symbol: "XLM", category: "crypto" },
  { rank: 13, name: "Shiba Inu", symbol: "SHIB", category: "crypto" },
  { rank: 14, name: "Hedera", symbol: "HBAR", category: "crypto" },
  { rank: 15, name: "Polkadot", symbol: "DOT", category: "crypto" },
  { rank: 16, name: "UNUS SED LEO", symbol: "LEO", category: "crypto" },
  { rank: 17, name: "Litecoin", symbol: "LTC", category: "crypto" },
  { rank: 18, name: "Sui", symbol: "SUI", category: "crypto" },
  { rank: 19, name: "Uniswap", symbol: "UNI", category: "crypto" },
  { rank: 20, name: "Aptos", symbol: "APT", category: "crypto" }
];

const PRECIOUS_METAL_ASSETS: MarketCatalogEntry[] = [
  { rank: 1, name: "Gold (XAUT)", symbol: "XAUT", category: "metal" },
  { rank: 2, name: "Silver", symbol: "XAG", category: "metal" },
  { rank: 3, name: "Platinum", symbol: "XPT", category: "metal" },
  { rank: 4, name: "Palladium", symbol: "XPD", category: "metal" }
];

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

function extractSeriesChangePct(series: unknown[]): number | null {
  if (!Array.isArray(series) || series.length < 2) {
    return null;
  }

  const newest = extractSeriesPrice(series[0]);
  const oldest = extractSeriesPrice(series[series.length - 1]);

  if (!newest || !oldest) {
    return null;
  }

  return ((newest - oldest) / oldest) * 100;
}

const pricingClient = new BitfinexPricingClient();
const pricingProvider = new PricingProvider({
  client: pricingClient,
  priceCacheDurationMs: 30 * 1000
});

async function getPairSnapshot(from: string, to = "USD"): Promise<PriceSnapshot> {
  try {
    const price = await pricingProvider.getLastPrice(from, to);
    const end = Date.now();
    const start = end - 24 * 60 * 60 * 1000;
    let changePct = 0;

    try {
      const series = await pricingProvider.getHistoricalPrice({ from, to, start, end });
      const extractedChange = extractSeriesChangePct(series);
      if (extractedChange !== null) {
        changePct = extractedChange;
      }
    } catch {
      changePct = 0;
    }

    if (from.toUpperCase() === "ETH" && to.toUpperCase() === "USD") {
      lastPrice = price;
    }

    return { price, changePct, source: "bitfinex" };
  } catch {
    const fallbackPrice = from.toUpperCase() === "ETH" && to.toUpperCase() === "USD"
      ? lastPrice ?? 3500
      : 0;
    const fallbackSource = from.toUpperCase() === "ETH" && to.toUpperCase() === "USD" && lastPrice
      ? "cache"
      : "fallback";

    return { price: fallbackPrice, changePct: 0, source: fallbackSource };
  }
}

async function buildTrackedMarketAsset(entry: MarketCatalogEntry): Promise<TrackedMarketAsset> {
  try {
    const snapshot = await getPairSnapshot(entry.symbol, "USD");
    const price = Number.isFinite(snapshot.price) && snapshot.price > 0 ? snapshot.price : null;
    return {
      rank: entry.rank,
      name: entry.name,
      symbol: entry.symbol,
      category: entry.category,
      price,
      changePct24h: price === null ? null : snapshot.changePct,
      source: snapshot.source,
      available: price !== null
    };
  } catch {
    return {
      rank: entry.rank,
      name: entry.name,
      symbol: entry.symbol,
      category: entry.category,
      price: null,
      changePct24h: null,
      source: "bitfinex",
      available: false
    };
  }
}

async function resolveTopCryptoCatalog(limit: number): Promise<{
  entries: MarketCatalogEntry[];
  rankingSource: "cmc" | "curated";
}> {
  try {
    const ranked = await getTopMarketCap(limit);
    return {
      entries: ranked.slice(0, limit).map((asset) => ({
        rank: asset.rank,
        name: asset.name,
        symbol: asset.symbol,
        category: "crypto" as const
      })),
      rankingSource: "cmc"
    };
  } catch {
    return {
      entries: CURATED_CRYPTO_ASSETS.slice(0, limit),
      rankingSource: "curated"
    };
  }
}

export async function getEthPrice(): Promise<PriceSnapshot> {
  return getPairSnapshot("ETH", "USD");
}

export async function getCurrentPrice(symbol: string): Promise<number> {
  try {
    const normalizedSymbol = symbol.toUpperCase() === "ETHEREUM" ? "ETH" : symbol.toUpperCase();
    const { price } = await getPairSnapshot(normalizedSymbol, "USD");
    return price;
  } catch {
    return 0;
  }
}

export async function get24hChange(symbol: string): Promise<number> {
  try {
    const normalizedSymbol = symbol.toUpperCase() === "ETHEREUM" ? "ETH" : symbol.toUpperCase();
    const { changePct } = await getPairSnapshot(normalizedSymbol, "USD");
    return changePct;
  } catch {
    return 0;
  }
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

export async function getTrackedMarketBoard(limit = 20): Promise<MarketBoard> {
  if (marketBoardCache && marketBoardCache.expiresAt > Date.now()) {
    return marketBoardCache.data;
  }

  const { entries, rankingSource } = await resolveTopCryptoCatalog(limit);
  const [crypto, metals] = await Promise.all([
    Promise.all(entries.map((entry) => buildTrackedMarketAsset(entry))),
    Promise.all(PRECIOUS_METAL_ASSETS.map((entry) => buildTrackedMarketAsset(entry)))
  ]);

  const board: MarketBoard = {
    updatedAt: new Date().toISOString(),
    pricingSource: "wdk-bitfinex",
    rankingSource,
    crypto,
    metals
  };

  marketBoardCache = {
    data: board,
    expiresAt: Date.now() + MARKET_BOARD_TTL_MS
  };

  return board;
}
