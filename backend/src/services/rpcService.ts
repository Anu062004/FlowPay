import { JsonRpcProvider } from "ethers";
import { env } from "../config/env.js";
import { isRetriableRpcError, withRpcRetry } from "./rpcRetryService.js";

function resolveRpcTemplate(value: string) {
  return value.replaceAll("{WDK_API_KEY}", env.WDK_API_KEY);
}

const primaryRpcUrl = resolveRpcTemplate(env.RPC_URL);
const fallbackRpcUrls = (env.RPC_FALLBACK_URLS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map(resolveRpcTemplate);

const rpcUrls = Array.from(new Set([primaryRpcUrl, ...fallbackRpcUrls]));
const providerCache = new Map<string, JsonRpcProvider>();
let rpcCursor = 0;

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

function nextRpcIndex() {
  const index = rpcCursor % rpcUrls.length;
  rpcCursor = (rpcCursor + 1) % rpcUrls.length;
  return index;
}

export function getPrimaryRpcUrl() {
  return primaryRpcUrl;
}

export function getRpcUrls() {
  return [...rpcUrls];
}

export function getRoundRobinRpcUrl() {
  return rpcUrls[nextRpcIndex()];
}

export function getRpcProvider(url = primaryRpcUrl) {
  const resolved = resolveRpcTemplate(url);
  let provider = providerCache.get(resolved);
  if (!provider) {
    provider = new JsonRpcProvider(resolved);
    providerCache.set(resolved, provider);
  }
  return provider;
}

function getCandidateRpcUrls() {
  const start = nextRpcIndex();
  return rpcUrls.slice(start).concat(rpcUrls.slice(0, start));
}

export async function withRpcFailover<T>(
  label: string,
  operation: (provider: JsonRpcProvider, rpcUrl: string) => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (const rpcUrl of getCandidateRpcUrls()) {
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
