const CACHE_TTL_MS = Number(process.env.REFERENCE_CACHE_TTL_MS || 120 * 1000); // 120s default (tuned)
const DEFAULT_RETRIES = Number(process.env.REFERENCE_DEFAULT_RETRIES || 4);
const DEFAULT_BACKOFF_MS = Number(process.env.REFERENCE_DEFAULT_BACKOFF_MS || 500);

type CacheEntry = { ts: number; data: any };

const cache = new Map<string, CacheEntry>();

export async function fetchWithRetryAndCache(url: string, options: RequestInit = {}, retries = DEFAULT_RETRIES, backoffMs = DEFAULT_BACKOFF_MS, useCache = true) {
  const key = `${url}|${JSON.stringify(options || {})}`;

  if (useCache) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  let attempt = 0;
  let lastError: any = null;

  while (attempt <= retries) {
    try {
      const resp = await fetch(url, options);
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        const err = new Error(`HTTP ${resp.status}: ${text}`);
        // For 429 or 5xx, allow retry
        if (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) {
          throw err;
        }
        // Non-retriable - throw immediately
        throw err;
      }
      const data = await resp.json().catch(async () => {
        // fallback: try text
        const t = await resp.text();
        try { return JSON.parse(t); } catch { return t; }
      });

      if (useCache) cache.set(key, { ts: Date.now(), data });
      return data;
    } catch (err: any) {
      lastError = err;
      attempt += 1;
      if (attempt > retries) break;
      // exponential backoff with jitter
      const jitter = Math.floor(Math.random() * 200);
      const wait = backoffMs * Math.pow(2, attempt - 1) + jitter;
      await new Promise((res) => setTimeout(res, wait));
    }
  }

  throw lastError || new Error("Unknown fetch error");
}

export function clearReferenceCache() {
  cache.clear();
}

export function getCacheStats() {
  return { keys: cache.size, ttlMs: CACHE_TTL_MS };
}