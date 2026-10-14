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
 * Detect whether a URL points at a private, loopback, or otherwise non-public
 * address — based on the syntactic host in the URL.
 *
 * This is a *syntactic* check. It inspects the host literal and does NOT
 * resolve DNS. A hostname like "attacker.example" that resolves to 127.0.0.1
 * will NOT be flagged here; use {@link isPrivateDestination} for a
 * DNS-resolving check that catches that case.
 *
 * Returns true for:
 *  - loopback (127.0.0.0/8, ::1, IPv4-mapped ::ffff:127.0.0.1)
 *  - private ranges (10/8, 172.16/12, 192.168/16, fc00::/7)
 *  - link-local (169.254/16, fe80::/10)
 *  - "localhost" / "*.localhost" hostnames
 *  - 0.0.0.0
 *  - IPv4-mapped IPv6 of any private IPv4
 *  - CGNAT 100.64.0.0/10
 *  - benchmarking / documentation ranges (198.18/15, 192.0.2/24, 198.51.100/24, 203.0.113/24)
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
    return isPrivateIPv4(Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4]));
  }
  // IPv6 (rough): loopback ::1, unique-local fc00::/7, link-local fe80::/10,
  // and IPv4-mapped IPv6 (::ffff:a.b.c.d) — unwrap and re-test as IPv4.
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
  // IPv4-mapped IPv6: ::ffff:a.b.c.d or ::ffff:xxxx:xxxx
  const mapped = host.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (mapped && mapped[1] && mapped[2] && mapped[3] && mapped[4]) {
    return isPrivateIPv4(
      Number(mapped[1]),
      Number(mapped[2]),
      Number(mapped[3]),
      Number(mapped[4]),
    );
  }
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex && mappedHex[1] && mappedHex[2]) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const o1 = (hi >> 8) & 0xff;
    const o2 = hi & 0xff;
    const o3 = (lo >> 8) & 0xff;
    const o4 = lo & 0xff;
    return isPrivateIPv4(o1, o2, o3, o4);
  }
  // Unspecified address.
  if (host === '::') return true;
  return false;
}

/** Test whether an IPv4 octet quadruplet is private/non-public. */
export function isPrivateIPv4(o1: number, o2: number, o3: number, o4: number): boolean {
  if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) return false;
  if (o1 === 0) return true; // 0.0.0.0/8
  if (o1 === 10) return true; // 10/8
  if (o1 === 127) return true; // loopback 127/8
  if (o1 === 169 && o2 === 254) return true; // link-local 169.254/16
  if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // 172.16/12
  if (o1 === 192 && o2 === 168) return true; // 192.168/16
  if (o1 === 100 && o2 >= 64 && o2 <= 127) return true; // CGNAT 100.64/10
  if (o1 === 192 && o2 === 0 && o3 === 2) return true; // TEST-NET-1 192.0.2/24
  if (o1 === 198 && o2 === 51 && o3 === 100) return true; // TEST-NET-2 198.51.100/24
  if (o1 === 203 && o2 === 0 && o3 === 113) return true; // TEST-NET-3 203.0.113/24
  if (o1 === 198 && (o2 === 18 || o2 === 19)) return true; // benchmarking 198.18/15
  return false;
}

/** A stable, normalized key for deduplicating URLs during a crawl. */
export function urlKey(url: string): string {
  return normalizeUrl(url);
}

/** Extract the bare host (without brackets for IPv6) from a URL string. */
export function hostOf(url: string): string {
  const parsed = new URL(url);
  let h = parsed.hostname.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  return h;
}
