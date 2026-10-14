/**
 * URL utilities: normalization, same-origin checks, private-address detection,
 * and relative-link resolution.
 *
 * These helpers are the foundation of safe, predictable crawling. They are
 * intentionally small and dependency-free so they can be unit-tested in
 * isolation.
 */
import { ScrapeKitError } from '../types/index.js';

/**
 * Normalise a URL string into a canonical absolute URL.
 *
 * Normalisation includes:
 *  - lowercasing the scheme and host,
 *  - removing the default port,
 *  - removing the fragment,
 *  - collapsing trailing slashes on the path (root "/" is preserved),
 *  - removing a default `www.`-style duplication is intentionally NOT done
 *    (it would change the destination host).
 *
 * Throws ScrapeKitError (code "INVALID_URL") for invalid input.
 */
export function normalizeUrl(input: string, baseUrl?: string): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new ScrapeKitError('A non-empty URL string is required.', 'INVALID_URL');
  }
  let url: URL;
  try {
    url = baseUrl ? new URL(input, baseUrl) : new URL(input);
  } catch {
    throw new ScrapeKitError(`Invalid URL: ${input}`, 'INVALID_URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ScrapeKitError(
      `Unsupported protocol "${url.protocol}". Only http and https are supported.`,
      'INVALID_URL',
    );
  }
  url.hash = '';
  // Lowercase host (URL already does this for the hostname, but be explicit).
  url.hostname = url.hostname.toLowerCase();
  // Remove default port.
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }
  // Collapse duplicate trailing slashes, but keep root "/".
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

/**
 * Resolve a possibly-relative link against a base URL and return the absolute
 * URL string, or null if the link is not resolvable to an http(s) URL.
 */
export function resolveUrl(link: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(link, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }
    return normalizeUrl(resolved.toString());
  } catch {
    return null;
  }
}

/** Return true iff two URL strings share the same normalized origin. */
export function isSameOrigin(a: string, b: string): boolean {
  let ua: URL;
  let ub: URL;
  try {
    ua = new URL(a);
    ub = new URL(b);
  } catch {
    return false;
  }
  return ua.protocol === ub.protocol && ua.hostname === ub.hostname && ua.port === ub.port;
}

/**
 * Detect whether a URL points at a private, loopback, or link-local address.
 * Used to prevent accidental SSRF-style crawling of internal networks.
 *
 * Returns true for:
 *  - loopback (127.0.0.0/8, ::1)
 *  - private ranges (10/8, 172.16/12, 192.168/16, fc00::/7)
 *  - link-local (169.254/16, fe80::/10)
 *  - "localhost" hostname
 *  - 0.0.0.0
 */
export function isPrivateAddress(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true; // treat invalid as unsafe
  }
  // WHATWG URL serializes IPv6 hostnames WITH brackets in .hostname.
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') {
    return true;
  }
  if (host.endsWith('.localhost')) {
    return true;
  }
  // IPv4 dotted quad.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o1 = Number(v4[1]);
    const o2 = Number(v4[2]);
    const o3 = Number(v4[3]);
    const o4 = Number(v4[4]);
    if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) return false;
    if (o1 === 10) return true;
    if (o1 === 127) return true;
    if (o1 === 0) return true;
    if (o1 === 169 && o2 === 254) return true;
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
    if (o1 === 192 && o2 === 168) return true;
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true; // CGNAT
    return false;
  }
  // IPv6 (rough): loopback ::1, unique-local fc00::/7, link-local fe80::/10.
  if (host === '::1') return true;
  if (host.startsWith('fc') || host.startsWith('fd')) return true;
  if (
    host.startsWith('fe80') ||
    host.startsWith('fe90') ||
    host.startsWith('fea0') ||
    host.startsWith('feb0')
  ) {
    return true;
  }
  return false;
}

/** A stable, normalized key for deduplicating URLs during a crawl. */
export function urlKey(url: string): string {
  return normalizeUrl(url);
}
