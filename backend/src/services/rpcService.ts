import { JsonRpcProvider } from "ethers";
import { env } from "../config/env.js";
import { isRetriableRpcError, withRpcRetry } from "./rpcRetryService.js";

type RpcPool = {
  key: string;
  primary: string;
  urls: string[];
};

function resolveRpcTemplate(value: string) {
  return value.replaceAll("{WDK_API_KEY}", env.WDK_API_KEY);
}

function parseRpcUrls(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(resolveRpcTemplate);
}

function buildRpcPool(key: string, primaryUrl: string, fallbackUrls?: string) {
  const primary = resolveRpcTemplate(primaryUrl);
  return {
    key,
    primary,
    urls: Array.from(new Set([primary, ...parseRpcUrls(fallbackUrls)]))
  } satisfies RpcPool;
}

function normalizeChain(chain: string) {
  return chain.trim().toLowerCase();
}

const defaultRpcPool = buildRpcPool("default", env.RPC_URL, env.RPC_FALLBACK_URLS);
const contractRpcPool = buildRpcPool(
  "contract",
  env.FLOWPAY_CONTRACT_RPC_URL?.trim() || env.RPC_URL,
  env.FLOWPAY_CONTRACT_RPC_FALLBACK_URLS ?? env.RPC_FALLBACK_URLS
);
const chainRpcPools = new Map<string, RpcPool>([
  [
    "ethereum",
    buildRpcPool(
      "ethereum",
      env.ETHEREUM_RPC_URL?.trim() || env.RPC_URL,
      env.ETHEREUM_RPC_FALLBACK_URLS ?? env.RPC_FALLBACK_URLS
    )
  ],
  [
    "sepolia",
    buildRpcPool(
      "sepolia",
      env.SEPOLIA_RPC_URL?.trim() || env.RPC_URL,
      env.SEPOLIA_RPC_FALLBACK_URLS ?? env.RPC_FALLBACK_URLS
    )
  ]
]);
const providerCache = new Map<string, JsonRpcProvider>();
const rpcCursorByPool = new Map<string, number>();

function maskRpcUrl(url: string) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length > 0) {
      const last = segments[segments.length - 1];
      segments[segments.length - 1] =
        last.length > 8 ? `${last.slice(0, 4)}...${last.slice(-4)}` : "***";
      parsed.pathname = `/${segments.join("/")}`;
    }
    return parsed.toString();
  } catch {
    return "<rpc>";
  }
}

function getRpcPoolForChain(chain: string) {
  return chainRpcPools.get(normalizeChain(chain)) ?? defaultRpcPool;
}

function nextRpcIndex(pool: RpcPool) {
  const current = rpcCursorByPool.get(pool.key) ?? 0;
  const index = current % pool.urls.length;
  rpcCursorByPool.set(pool.key, (current + 1) % pool.urls.length);
  return index;
}

function getCandidateRpcUrls(pool: RpcPool) {
  const start = nextRpcIndex(pool);
  return pool.urls.slice(start).concat(pool.urls.slice(0, start));
}

export function getPrimaryRpcUrl() {
  return defaultRpcPool.primary;
}

export function getContractPrimaryRpcUrl() {
  return contractRpcPool.primary;
}

export function getChainPrimaryRpcUrl(chain: string) {
  return getRpcPoolForChain(chain).primary;
}

export function getRpcUrls() {
  return [...defaultRpcPool.urls];
}

export function getContractRpcUrls() {
  return [...contractRpcPool.urls];
}

export function getRpcUrlsForChain(chain: string) {
  return [...getRpcPoolForChain(chain).urls];
}

export function getRoundRobinRpcUrl() {
  return defaultRpcPool.urls[nextRpcIndex(defaultRpcPool)];
}

export function getContractRoundRobinRpcUrl() {
  return contractRpcPool.urls[nextRpcIndex(contractRpcPool)];
}

export function getRoundRobinRpcUrlForChain(chain: string) {
  const pool = getRpcPoolForChain(chain);
  return pool.urls[nextRpcIndex(pool)];
}

export function getRpcProvider(url = defaultRpcPool.primary) {
  const resolved = resolveRpcTemplate(url);
  let provider = providerCache.get(resolved);
  if (!provider) {
    provider = new JsonRpcProvider(resolved);
    providerCache.set(resolved, provider);
  }
  return provider;
}

export function getRpcProviderForChain(chain: string, url = getChainPrimaryRpcUrl(chain)) {
  return getRpcProvider(url);
}

export function getContractRpcProvider(url = getContractPrimaryRpcUrl()) {
  return getRpcProvider(url);
}

export async function withRpcFailover<T>(
  label: string,
  operation: (provider: JsonRpcProvider, rpcUrl: string) => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (const rpcUrl of getCandidateRpcUrls(defaultRpcPool)) {
    try {
      return await withRpcRetry(`${label} via ${maskRpcUrl(rpcUrl)}`, () =>
        operation(getRpcProvider(rpcUrl), rpcUrl)
      );
    } catch (error) {
      lastError = error;
      if (!isRetriableRpcError(error)) {
        throw error;
      }
      console.warn(
        `[RPC] ${label} switching provider after ${maskRpcUrl(rpcUrl)} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  throw lastError;
}

export async function withContractRpcFailover<T>(
  label: string,
  operation: (provider: JsonRpcProvider, rpcUrl: string) => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (const rpcUrl of getCandidateRpcUrls(contractRpcPool)) {
    try {
      return await withRpcRetry(`${label} via ${maskRpcUrl(rpcUrl)}`, () =>
        operation(getContractRpcProvider(rpcUrl), rpcUrl)
      );
    } catch (error) {
      lastError = error;
      if (!isRetriableRpcError(error)) {
        throw error;
      }
      console.warn(
        `[RPC] ${label} switching provider after ${maskRpcUrl(rpcUrl)} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  throw lastError;
}

export async function withRpcFailoverForChain<T>(
  chain: string,
  label: string,
  operation: (provider: JsonRpcProvider, rpcUrl: string) => Promise<T>
): Promise<T> {
  const pool = getRpcPoolForChain(chain);
  let lastError: unknown;
  for (const rpcUrl of getCandidateRpcUrls(pool)) {
    try {
      return await withRpcRetry(`${label} via ${maskRpcUrl(rpcUrl)}`, () =>
        operation(getRpcProviderForChain(chain, rpcUrl), rpcUrl)
      );
    } catch (error) {
      lastError = error;
      if (!isRetriableRpcError(error)) {
        throw error;
      }
      console.warn(
        `[RPC] ${label} switching provider after ${maskRpcUrl(rpcUrl)} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  throw lastError;
}
