/**
 * Exponential-backoff retry for fetch, with per-request timeout + Retry-After honoring.
 */
export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  timeoutMs?: number;
  shouldRetry?: (resp: Response | null, err: unknown, attempt: number) => boolean;
}

const defaultShouldRetry = (resp: Response | null, err: unknown): boolean => {
  if (err) return true; // network error / abort
  if (!resp) return true;
  if (resp.status === 429) return true;
  if (resp.status >= 500) return true;
  return false;
};

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const asInt = parseInt(value, 10);
  if (!isNaN(asInt)) return asInt * 1000;
  const asDate = Date.parse(value);
  if (!isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? 4;
  const baseMs = opts.baseMs ?? 600;
  const maxMs = opts.maxMs ?? 8_000;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const abortCtrl = new AbortController();
    const t = setTimeout(() => abortCtrl.abort(new Error(`request timeout after ${timeoutMs}ms`)), timeoutMs);

    // If caller passed their own signal, link it.
    const mergedSignal = init.signal
      ? AbortSignal.any([init.signal, abortCtrl.signal])
      : abortCtrl.signal;

    try {
      const resp = await fetch(url, { ...init, signal: mergedSignal });
      clearTimeout(t);
      if (resp.ok || !shouldRetry(resp, null, attempt)) {
        return resp;
      }
      if (attempt === retries) return resp;
      // Honor Retry-After if present
      const retryAfter = parseRetryAfter(resp.headers.get("retry-after"));
      const backoff = Math.min(baseMs * Math.pow(2, attempt), maxMs);
      const delay = retryAfter ?? backoff;
      const jitter = Math.random() * 0.2 * delay;
      await sleep(delay + jitter);
    } catch (err) {
      clearTimeout(t);
      lastErr = err;
      if (attempt === retries) throw err;
      if (!shouldRetry(null, err, attempt)) throw err;
      const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
      await sleep(delay);
    }
  }
  throw lastErr ?? new Error("fetchWithRetry: exhausted retries");
}

/** Simple sleep helper. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
