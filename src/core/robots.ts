/**
 * robots.txt integration.
 *
 * Fetches and parses a host's robots.txt using the well-maintained
 * `robots-parser` package, with a small in-memory cache keyed by origin.
 *
 * The bundled type definitions for `robots-parser` are ambiguous, so we
 * declare a concrete `RobotsResult` interface and coerce the import.
 */
import robotsParserModule from 'robots-parser';
import type { FetcherOptions } from '../types/index.js';
import { fetchDocument } from './fetcher.js';
import { normalizeUrl } from './url.js';

/** Concrete shape returned by robots-parser. */
export interface RobotsResult {
  isAllowed(url: string, ua?: string): boolean | undefined;
  isDisallowed(url: string, ua?: string): boolean | undefined;
  getMatchingLineNumber(url: string, ua?: string): number;
  getCrawlDelay(ua?: string): number | undefined;
  getSitemaps(): string[];
  getPreferredHost(): string | null;
}

// Coerce the (ambiguously-typed) default export to a concrete function.
const robotsParser = robotsParserModule as unknown as (url: string, body: string) => RobotsResult;

export interface RobotsRule {
  /** The URL being tested. */
  url: string;
  /** Whether the URL is allowed for the configured user-agent. */
  allowed: boolean;
}

interface CacheEntry {
  parsed: RobotsResult;
  fetchedAt: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const cache = new Map<string, CacheEntry>();

/**
 * Build the robots.txt URL for a given page URL.
 */
export function robotsUrlFor(pageUrl: string): string {
  const url = new URL(pageUrl);
  return normalizeUrl(`${url.origin}/robots.txt`);
}

/**
 * Load (and cache) the robots.txt for a given page URL's origin.
 *
 * If the robots.txt cannot be fetched (network error, 5xx), ScrapeKit
 * follows the conservative convention of disallowing everything for that
 * origin. A 4xx robots.txt (including 404) is treated as "fully allowed".
 */
export async function loadRobots(
  pageUrl: string,
  fetcherOptions: FetcherOptions = {},
  options: { ttlMs?: number; userAgent?: string } = {},
): Promise<RobotsResult> {
  const robotsUrl = robotsUrlFor(pageUrl);
  const origin = new URL(robotsUrl).origin;
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const cached = cache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached.parsed;
  }

  let body = '';
  let status = 404;
  try {
    const doc = await fetchDocument(robotsUrl, {
      ...fetcherOptions,
      // robots.txt fetches should be quick and not retry aggressively.
      maxRedirects: 3,
    });
    body = doc.body;
    status = doc.status;
  } catch {
    // Network error fetching robots.txt: be conservative and disallow.
    status = 503;
    body = '';
  }

  // Per RFC 9309: a 4xx (including 404) means "fully allowed".
  // A 5xx means we should be conservative and disallow.
  let parsed: RobotsResult;
  if (status >= 500) {
    parsed = robotsParser(robotsUrl, 'User-agent: *\nDisallow: /\n');
  } else {
    parsed = robotsParser(robotsUrl, body);
  }

  cache.set(origin, { parsed, fetchedAt: Date.now() });
  return parsed;
}

/**
 * Test whether a URL is allowed for the given user-agent.
 */
export function isAllowed(robots: RobotsResult, url: string, userAgent: string): boolean {
  return robots.isAllowed(url, userAgent) ?? true;
}

/** Clear the robots.txt cache (useful in tests). */
export function clearRobotsCache(): void {
  cache.clear();
}
