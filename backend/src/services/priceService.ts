import { env } from "../config/env.js";

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

export async function getEthPrice(): Promise<PriceSnapshot> {
  const defaultCmcUrl =
    "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=ETH";
  const defaultCoingeckoUrl =
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";

  const cmcKey =
    env.CMC_API_KEY ||
    (env.PRICE_API_URL?.includes("coinmarketcap") ? env.PRICE_API_KEY : undefined);
  const cmcUrl = env.CMC_API_URL ?? env.PRICE_API_URL ?? defaultCmcUrl;

  if (cmcKey) {
    const response = await fetch(cmcUrl, {
      headers: { "X-CMC_PRO_API_KEY": cmcKey }
    });
    const data = await response.json();
    const quote = data?.data?.ETH?.quote?.USD;
    const price = parseNumber(quote?.price);
    const changePct = parseNumber(quote?.percent_change_24h) ?? 0;
    if (price === null) {
      throw new Error("Unable to fetch ETH price from CoinMarketCap");
    }
    lastPrice = price;
    return { price, changePct, source: "coinmarketcap" };
  }

  const url = env.PRICE_API_URL ?? defaultCoingeckoUrl;
  const response = await fetch(url, {
    headers: env.PRICE_API_KEY ? { Authorization: `Bearer ${env.PRICE_API_KEY}` } : undefined
  });

  const data = await response.json();
  const price = parseNumber(data?.ethereum?.usd ?? data?.price);
  if (price === null) {
    throw new Error("Unable to fetch ETH price");
  }

  const changePct = lastPrice ? ((price - lastPrice) / lastPrice) * 100 : 0;
  lastPrice = price;
  return { price, changePct, source: "coingecko" };
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
