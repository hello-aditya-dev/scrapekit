/**
 * Retry helper with exponential backoff and bounded jitter.
 *
 * Retries are only attempted for transient failures (timeouts, network errors,
 * 5xx responses, and 429 rate-limit responses). Permanent client errors
 * (4xx other than 429) are never retried.
 */
import type { RetryOptions } from '../types/index.js';

const DEFAULTS: Required<Omit<RetryOptions, 'signal'>> = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  respectRetryAfter: true,
};

export interface AttemptResult<T> {
  value: T;
  attempts: number;
}

/**
 * Run an async operation with retry semantics.
 *
 * The `shouldRetry` predicate decides whether an error/result combination is
 * retriable. The optional `getRetryAfterMs` returns a server-provided delay
 * (e.g. from a Retry-After header) that overrides the computed backoff when
 * `respectRetryAfter` is true.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  shouldRetry: (error: unknown, attempt: number) => boolean,
  options: RetryOptions = {},
  getRetryAfterMs?: (error: unknown) => number | undefined,
): Promise<AttemptResult<T>> {
  const opts = { ...DEFAULTS, ...options };
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const value = await operation(attempt);
      return { value, attempts: attempt };
    } catch (error) {
      if (opts.signal?.aborted) {
        throw error;
      }
      const canRetry = attempt <= opts.maxRetries && shouldRetry(error, attempt);
      if (!canRetry) {
        throw error;
      }
      let delay = computeBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs);
      if (opts.respectRetryAfter && getRetryAfterMs) {
        const serverDelay = getRetryAfterMs(error);
        if (serverDelay !== undefined && serverDelay >= 0) {
          // Respect the server's directive, but cap at a hard 60s ceiling so a
          // malicious or misconfigured server cannot stall us indefinitely.
          delay = Math.min(serverDelay, 60_000);
        }
      }
      await sleep(delay, opts.signal);
    }
  }
}

/** Compute exponential backoff with full jitter, capped at maxDelayMs. */
export function computeBackoff(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exp = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  // Full jitter: uniform random in [0, exp].
  const jitter = Math.floor(Math.random() * exp);
  return Math.min(jitter, maxDelayMs);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
