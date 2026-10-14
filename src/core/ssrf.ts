/**
 * Destination validation for SSRF protection.
 *
 * The syntactic `isPrivateAddress` check in `url.ts` only inspects the host
 * literal. A hostname (e.g. `attacker.example`) can resolve to a private IP,
 * which defeats syntactic checks. This module resolves the hostname via
 * `node:dns` and validates that *every* returned address is public before a
 * request is made.
 *
 * Because `fetch()` does not let callers pin the resolved address, this is a
 * **time-of-check** guard, not a complete SSRF defense. A determined attacker
 * with control of the DNS server could rebind the record between the check and
 * the connection (TOCTOU / DNS rebinding). ScrapeKit documents this residual
 * risk honestly rather than claiming full SSRF protection.
 *
 * The guard is still valuable: it blocks the overwhelming majority of
 * accidental and naive-malicious SSRF attempts, including `localhost`,
 * `127.0.0.1`, RFC 1918 ranges, link-local, IPv4-mapped IPv6, and hostnames
 * that resolve to any of those.
 */
import { promises as dns } from 'node:dns';
import { isPrivateIPv4 } from './url.js';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface DestinationCheckResult {
  /** Whether the destination was deemed safe to contact. */
  allowed: boolean;
  /** The resolved addresses (for logging/diagnostics). */
  addresses: ResolvedAddress[];
  /** Reason for the decision. */
  reason: string;
}

/**
 * Resolve a hostname and verify that every resolved address is public.
 *
 * Returns `allowed: false` if any resolved address is private, loopback,
 * link-local, or otherwise non-public. Returns `allowed: true` only if the
 * hostname resolves to at least one address and all addresses are public.
 *
 * Hostnames that are already IP literals are validated directly without DNS.
 */
export type DnsLookupFn = (
  hostname: string,
  options?: { all?: boolean },
) => Promise<Array<{ address: string; family: number }>>;

/**
 * Resolve a hostname and verify that every resolved address is public.
 *
 * Returns `allowed: false` if any resolved address is private, loopback,
 * link-local, or otherwise non-public. Returns `allowed: true` only if the
 * hostname resolves to at least one address and all addresses are public.
 *
 * Hostnames that are already IP literals are validated directly without DNS.
 *
 * The `lookupFn` option accepts any function with the shape
 * `(hostname, options) => Promise<Array<{address, family}>>` so tests can
 * inject a stub without satisfying the full `dns.lookup` overload signature.
 */
export async function checkDestination(
  hostname: string,
  options: { allowPrivate?: boolean; lookupFn?: DnsLookupFn } = {},
): Promise<DestinationCheckResult> {
  if (options.allowPrivate) {
    return { allowed: true, addresses: [], reason: 'private addresses explicitly allowed' };
  }
  const bare = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // Fast path: if it's already an IP literal, validate it directly.
  const ipCheck = checkIpLiteral(bare);
  if (ipCheck !== null) {
    return ipCheck
      ? { allowed: false, addresses: [], reason: `IP literal ${bare} is private/non-public` }
      : {
          allowed: true,
          addresses: [{ address: bare, family: bare.includes(':') ? 6 : 4 }],
          reason: 'public IP literal',
        };
  }
  // Block localhost-style hostnames syntactically (without DNS).
  if (bare === 'localhost' || bare.endsWith('.localhost')) {
    return { allowed: false, addresses: [], reason: `${bare} is a localhost hostname` };
  }
  // Resolve via DNS.
  const lookup = options.lookupFn ?? (dns.lookup as unknown as DnsLookupFn);
  let addresses: ResolvedAddress[];
  try {
    const result = await lookup(bare, { all: true });
    addresses = result.map((r) => ({ address: r.address, family: r.family as 4 | 6 }));
  } catch (err) {
    return {
      allowed: false,
      addresses: [],
      reason: `DNS resolution failed for ${bare}: ${(err as Error).message}`,
    };
  }
  if (addresses.length === 0) {
    return { allowed: false, addresses: [], reason: `${bare} resolved to no addresses` };
  }
  for (const a of addresses) {
    if (isPrivateIpString(a.address)) {
      return {
        allowed: false,
        addresses,
        reason: `${bare} resolves to private/non-public address ${a.address}`,
      };
    }
  }
  return { allowed: true, addresses, reason: `${bare} resolves to public address(es)` };
}

/** Returns true if the argument is an IP literal that is private/non-public. */
export function isPrivateIpString(ip: string): boolean {
  // IPv4-mapped IPv6 in dotted form.
  const mapped = ip.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i);
  if (mapped && mapped[1] && mapped[2] && mapped[3] && mapped[4]) {
    return isPrivateIPv4(
      Number(mapped[1]),
      Number(mapped[2]),
      Number(mapped[3]),
      Number(mapped[4]),
    );
  }
  // IPv4-mapped IPv6 in hex form ::ffff:xxxx:xxxx
  const mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHex && mappedHex[1] && mappedHex[2]) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIPv4((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff);
  }
  // Plain IPv4 dotted quad.
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4 && v4[1] && v4[2] && v4[3] && v4[4]) {
    return isPrivateIPv4(Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4]));
  }
  // IPv6 special cases.
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower === '::') return true; // unspecified
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local fc00::/7
  if (
    lower.startsWith('fe80') ||
    lower.startsWith('fe90') ||
    lower.startsWith('fea0') ||
    lower.startsWith('feb0')
  ) {
    return true; // link-local fe80::/10
  }
  return false;
}

/** If `host` is an IP literal, return whether it is private. Return null for hostnames. */
function checkIpLiteral(host: string): boolean | null {
  const lower = host.toLowerCase();
  // IPv6 (possibly mapped).
  if (lower.includes(':')) {
    return isPrivateIpString(lower);
  }
  // IPv4 dotted quad.
  const v4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    return isPrivateIPv4(Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4]));
  }
  return null; // hostname
}
