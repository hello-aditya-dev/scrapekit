/**
 * High-level fetch client: composes the raw fetcher with the retry policy.
 *
 * `fetchPage` returns a successful FetchedDocument for 2xx responses and
 * throws ScrapeKitError for everything else. Retriable conditions (timeouts,
 * network errors, 5xx, 429) are retried with exponential backoff and
 * Retry-After awareness.
 */
import {
  ScrapeKitError,
  type FetcherOptions,
  type FetchedDocument,
  type RetryOptions,
} from '../types/index.js';
import { fetchDocument } from './fetcher.js';
import { withRetry, type AttemptResult } from './retry.js';

/** A retriable HTTP-status error carrying a Retry-After hint. */
export class RetryableStatusError extends ScrapeKitError {
  readonly retryAfterMs?: number;
  constructor(status: number, url: string, retryAfterMs?: number) {
    super(`HTTP ${status} from "${url}"`, 'HTTP_ERROR', status);
    this.name = 'RetryableStatusError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Decide whether an error from the fetcher is retriable. */
export function isRetriableError(error: unknown): boolean {
  if (error instanceof ScrapeKitError) {
    if (error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR') return true;
    if (error.code === 'HTTP_ERROR' && typeof error.status === 'number') {
      return error.status === 429 || error.status >= 500;
    }
  }
  return false;
}

/**
 * Fetch a page with retry semantics. Returns the FetchedDocument on success.
 *
 * - 2xx → resolved document.
 * - 429 / 5xx → retried, then thrown as RetryableStatusError if exhausted.
 * - other 4xx → thrown immediately as ScrapeKitError (permanent).
 * - timeouts / network errors → retried, then thrown.
 */
export async function fetchPage(
  url: string,
  fetcherOptions: FetcherOptions = {},
  retryOptions: RetryOptions = {},
): Promise<AttemptResult<FetchedDocument>> {
  return withRetry<FetchedDocument>(
    async () => {
      const doc = await fetchDocument(url, fetcherOptions);
      if (doc.status >= 200 && doc.status < 300) {
        return doc;
      }
      if (doc.status === 429 || doc.status >= 500) {
        throw new RetryableStatusError(doc.status, doc.url, doc.retryAfterMs);
      }
      // Permanent client/server error (e.g. 403, 404, 400).
      throw new ScrapeKitError(`HTTP ${doc.status} from "${doc.url}"`, 'HTTP_ERROR', doc.status);
    },
    isRetriableError,
    retryOptions,
    (error) => (error instanceof RetryableStatusError ? error.retryAfterMs : undefined),
  );
}
