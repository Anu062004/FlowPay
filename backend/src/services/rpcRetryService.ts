type RpcRetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 1200;
const DEFAULT_MAX_DELAY_MS = 10_000;
const RETRIABLE_CODES = new Set(["BAD_DATA", "SERVER_ERROR", "NETWORK_ERROR", "TIMEOUT", "UNKNOWN_ERROR"]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorText(error: unknown) {
  if (error instanceof Error) {
    const extra = [
      (error as Error & { shortMessage?: string }).shortMessage,
      (error as Error & { code?: string }).code
    ]
      .filter(Boolean)
      .join(" ");
    return `${error.message} ${extra}`.trim();
  }
  return String(error);
}

export function isRetriableRpcError(error: unknown) {
  const text = getErrorText(error).toLowerCase();
  if (
    text.includes("too many requests") ||
    text.includes("missing response for request") ||
    text.includes("timeout") ||
    text.includes("temporarily unavailable") ||
    text.includes("rate limit")
  ) {
    return true;
  }

  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && RETRIABLE_CODES.has(code)) {
      return true;
    }

    const value = (error as { value?: unknown }).value;
    if (
      Array.isArray(value) &&
      value.some(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          ((entry as { code?: unknown }).code === -32005 ||
            String((entry as { message?: unknown }).message ?? "")
              .toLowerCase()
              .includes("too many requests"))
      )
    ) {
      return true;
    }
  }

  return false;
}

export async function withRpcRetry<T>(
  label: string,
  operation: () => Promise<T>,
  options: RpcRetryOptions = {}
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetriableRpcError(error)) {
        throw error;
      }

      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      console.warn(
        `[RPC] ${label} failed on attempt ${attempt}/${attempts}: ${getErrorText(error)}. Retrying in ${delayMs}ms.`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}
