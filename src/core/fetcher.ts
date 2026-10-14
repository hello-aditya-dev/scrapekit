/**
 * HTTP fetcher.
 *
 * Wraps the global `fetch` with:
 *  - request timeouts via AbortController (distinct from caller cancellation),
 *  - manual redirect handling with bounded hops,
 *  - SSRF protection: syntactic private-address checks AND DNS resolution of
 *    hostnames to reject destinations that resolve to private/non-public IPs,
 *  - 429 / Retry-After detection,
 *  - response-body size limits to prevent memory exhaustion,
 *  - a descriptive User-Agent.
 *
 * The fetcher is intentionally "dumb" about retries: retry orchestration is
 * handled by `retry.ts` so that the crawler and CLI can share the same policy.
 *
 * SSRF note: the DNS check is a time-of-check guard. Node's `fetch` does not
 * expose a way to pin the resolved address, so a DNS-rebinding attacker with
 * control of the authoritative server could theoretically change the record
 * between the check and the connection. This is a residual risk documented in
 * SECURITY.md; the check still blocks the vast majority of accidental and
 * naive SSRF attempts.
 */
import { ScrapeKitError, type FetcherOptions, type FetchedDocument } from '../types/index.js';
import { isPrivateAddress, normalizeUrl } from './url.js';
import { checkDestination } from './ssrf.js';

export const DEFAULT_USER_AGENT = 'ScrapeKit/0.1 (+https://github.com/hello-aditya-dev/scrapekit)';
export const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_MAX_REDIRECTS = 5;
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MiB

/**
 * Fetch a URL and return the final document.
 *
 * Throws ScrapeKitError with a stable `code` for each failure mode:
 *  - INVALID_URL
 *  - BLOCKED_PRIVATE_ADDRESS
 *  - BLOCKED_PRIVATE_DESTINATION (DNS-resolved private address)
 *  - TIMEOUT
 *  - ABORTED (caller cancelled)
 *  - TOO_MANY_REDIRECTS
 *  - REDIRECT_TO_PRIVATE_ADDRESS
 *  - HTTP_ERROR (for 4xx/5xx after redirects are exhausted)
 *  - NETWORK_ERROR
 *  - RESPONSE_TOO_LARGE
 */
export async function fetchDocument(
  input: string,
  options: FetcherOptions = {},
): Promise<FetchedDocument> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const allowPrivate = options.allowPrivateAddresses ?? false;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

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

  // Track whether the *caller* cancelled, so we can distinguish TIMEOUT from ABORTED.
  const callerSignal = options.signal;
  let callerAborted = false;
  const timeoutController = new AbortController();
  const onCallerAbort = () => {
    callerAborted = true;
    timeoutController.abort();
  };
  if (callerSignal) {
    if (callerSignal.aborted) {
      callerAborted = true;
      timeoutController.abort();
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }
  const timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs);

  try {
    let redirects = 0;
    while (true) {
      // DNS-based SSRF check for the current URL's host (covers hostnames that
      // resolve to private IPs and rebinding-style attacks at the syntactic level).
      if (!allowPrivate) {
        const checker =
          options.ssrfChecker ?? ((h: string) => checkDestination(h, { allowPrivate: false }));
        const dest = await checker(new URL(currentUrl).hostname);
        if (!dest.allowed) {
          throw new ScrapeKitError(
            `Refusing to fetch "${currentUrl}": ${dest.reason}.`,
            'BLOCKED_PRIVATE_DESTINATION',
          );
        }
      }

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
        if (callerAborted) {
          throw new ScrapeKitError(
            `Request to "${currentUrl}" was aborted by the caller.`,
            'ABORTED',
          );
        }
        if (timeoutController.signal.aborted) {
          throw new ScrapeKitError(
            `Request to "${currentUrl}" timed out after ${timeoutMs}ms.`,
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

      const body = await readBodyWithLimit(response, maxBodyBytes, currentUrl);

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

/** Read the response body with a byte limit to prevent memory exhaustion. */
async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
  url: string,
): Promise<string> {
  if (!response.body) {
    // No streaming body — fall back to .text() (bounded by server content if any).
    return response.text().catch((err: unknown) => {
      throw new ScrapeKitError(
        `Failed to read response body from "${url}": ${(err as Error).message}`,
        'NETWORK_ERROR',
      );
    });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let result = '';
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.length > maxBytes) {
        // Take only the portion that fits, then stop.
        const remaining = maxBytes - received;
        if (remaining > 0) {
          result += decoder.decode(value.subarray(0, remaining), { stream: true });
        }
        truncated = true;
        break;
      }
      received += value.length;
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode(); // flush
  } catch (err) {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    throw new ScrapeKitError(
      `Failed to read response body from "${url}": ${(err as Error).message}`,
      'NETWORK_ERROR',
    );
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  if (truncated) {
    throw new ScrapeKitError(
      `Response body from "${url}" exceeded the ${maxBytes}-byte limit.`,
      'RESPONSE_TOO_LARGE',
    );
  }
  return result;
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
