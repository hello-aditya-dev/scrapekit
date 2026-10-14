/**
 * HTTP fetcher.
 *
 * Wraps the global `fetch` with:
 *  - request timeouts via AbortController,
 *  - manual redirect handling with bounded hops and private-address checks,
 *  - SSRF protection (private/loopback destinations blocked by default),
 *  - 429 / Retry-After detection,
 *  - a descriptive User-Agent.
 *
 * The fetcher is intentionally "dumb" about retries: retry orchestration is
 * handled by `retry.ts` so that the crawler and CLI can share the same policy.
 */
import { ScrapeKitError, type FetcherOptions, type FetchedDocument } from '../types/index.js';
import { isPrivateAddress, normalizeUrl } from './url.js';

export const DEFAULT_USER_AGENT = 'ScrapeKit/0.1 (+https://github.com/hello-aditya-dev/scrapekit)';
export const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_MAX_REDIRECTS = 5;

/**
 * Fetch a URL and return the final document.
 *
 * Throws ScrapeKitError with a stable `code` for each failure mode:
 *  - INVALID_URL
 *  - BLOCKED_PRIVATE_ADDRESS
 *  - TIMEOUT
 *  - TOO_MANY_REDIRECTS
 *  - REDIRECT_TO_PRIVATE_ADDRESS
 *  - HTTP_ERROR (for 4xx/5xx after redirects are exhausted)
 *  - NETWORK_ERROR
 */
export async function fetchDocument(
  input: string,
  options: FetcherOptions = {},
): Promise<FetchedDocument> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const allowPrivate = options.allowPrivateAddresses ?? false;

  let currentUrl: string;
  try {
    currentUrl = normalizeUrl(input);
  } catch (e) {
    if (e instanceof ScrapeKitError) throw e;
    throw new ScrapeKitError(`Invalid URL: ${input}`, 'INVALID_URL');
  }

  if (!allowPrivate && isPrivateAddress(currentUrl)) {
    throw new ScrapeKitError(
      `Refusing to fetch private/loopback address "${currentUrl}". ` +
        'Pass allowPrivateAddresses: true to override (e.g. for local testing).',
      'BLOCKED_PRIVATE_ADDRESS',
    );
  }

  const timeoutController = new AbortController();
  const timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs);
  // Link the caller's signal to the timeout controller so either can cancel.
  const callerSignal = options.signal;
  const onCallerAbort = () => timeoutController.abort();
  if (callerSignal) {
    if (callerSignal.aborted) timeoutController.abort();
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    let redirects = 0;
    while (true) {
      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: timeoutController.signal,
          headers: {
            'user-agent': userAgent,
            accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
            'accept-language': 'en;q=0.9',
          },
        });
      } catch (err) {
        if (timeoutController.signal.aborted) {
          throw new ScrapeKitError(
            `Request to "${currentUrl}" timed out or was aborted after ${timeoutMs}ms.`,
            'TIMEOUT',
          );
        }
        throw new ScrapeKitError(
          `Network error fetching "${currentUrl}": ${(err as Error).message}`,
          'NETWORK_ERROR',
        );
      }

      // Handle redirect (status 3xx with Location).
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new ScrapeKitError(
            `Redirect with no Location header from "${currentUrl}" (status ${response.status}).`,
            'HTTP_ERROR',
            response.status,
          );
        }
        redirects++;
        if (redirects > maxRedirects) {
          throw new ScrapeKitError(
            `Too many redirects (>${maxRedirects}) when fetching "${input}".`,
            'TOO_MANY_REDIRECTS',
          );
        }
        let nextUrl: string;
        try {
          nextUrl = normalizeUrl(location, currentUrl);
        } catch {
          throw new ScrapeKitError(
            `Invalid redirect Location "${location}" from "${currentUrl}".`,
            'HTTP_ERROR',
            response.status,
          );
        }
        if (!allowPrivate && isPrivateAddress(nextUrl)) {
          throw new ScrapeKitError(
            `Redirect from "${currentUrl}" to private address "${nextUrl}" was blocked.`,
            'REDIRECT_TO_PRIVATE_ADDRESS',
          );
        }
        currentUrl = nextUrl;
        continue;
      }

      const body = await response.text().catch((err: unknown) => {
        throw new ScrapeKitError(
          `Failed to read response body from "${currentUrl}": ${(err as Error).message}`,
          'NETWORK_ERROR',
        );
      });

      const rateLimited = response.status === 429;
      let retryAfterMs: number | undefined;
      if (rateLimited) {
        retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      }

      return {
        url: currentUrl,
        status: response.status,
        body,
        rateLimited,
        retryAfterMs,
      };
    }
  } finally {
    clearTimeout(timeoutTimer);
    if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * Parse a Retry-After header value into milliseconds.
 * Supports both delta-seconds and HTTP-date forms.
 * Returns undefined for invalid or missing values.
 */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? seconds * 1000 : undefined;
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    const diff = date - Date.now();
    return diff > 0 ? diff : 0;
  }
  return undefined;
}
