import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  resolveUrl,
  isSameOrigin,
  isPrivateAddress,
  urlKey,
} from '../../src/core/url.js';
import { ScrapeKitError } from '../../src/types/index.js';

describe('url utilities', () => {
  describe('normalizeUrl', () => {
    it('lowercases scheme and host', () => {
      expect(normalizeUrl('HTTPS://Example.COM/Path')).toBe('https://example.com/Path');
    });
    it('removes the default https port', () => {
      expect(normalizeUrl('https://example.com:443/path')).toBe('https://example.com/path');
    });
    it('removes the default http port', () => {
      expect(normalizeUrl('http://example.com:80/path')).toBe('http://example.com/path');
    });
    it('keeps a non-default port', () => {
      expect(normalizeUrl('http://example.com:8080/path')).toBe('http://example.com:8080/path');
    });
    it('removes the fragment', () => {
      expect(normalizeUrl('https://example.com/path#section')).toBe('https://example.com/path');
    });
    it('removes a trailing slash but preserves root', () => {
      expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });
    it('collapses duplicate slashes', () => {
      expect(normalizeUrl('https://example.com//a///b')).toBe('https://example.com/a/b');
    });
    it('resolves relative URLs against a base', () => {
      expect(normalizeUrl('/about', 'https://example.com/page')).toBe('https://example.com/about');
    });
    it('throws on invalid input', () => {
      expect(() => normalizeUrl('')).toThrow(ScrapeKitError);
      expect(() => normalizeUrl('not a url')).toThrow(ScrapeKitError);
    });
    it('rejects non-http protocols', () => {
      expect(() => normalizeUrl('ftp://example.com/file')).toThrow(ScrapeKitError);
      expect(() => normalizeUrl('file:///etc/passwd')).toThrow(ScrapeKitError);
    });
  });

  describe('resolveUrl', () => {
    it('resolves relative links', () => {
      expect(resolveUrl('/about', 'https://example.com/page')).toBe('https://example.com/about');
    });
    it('resolves "../" links', () => {
      expect(resolveUrl('../about', 'https://example.com/a/b')).toBe('https://example.com/about');
    });
    it('returns null for non-http protocols', () => {
      expect(resolveUrl('mailto:foo@bar.com', 'https://example.com')).toBeNull();
      expect(resolveUrl('javascript:void(0)', 'https://example.com')).toBeNull();
    });
    it('returns null for invalid input', () => {
      // `new URL` rejects a scheme-only string even with a base.
      expect(resolveUrl('http://', 'https://example.com')).toBeNull();
    });
  });

  describe('isSameOrigin', () => {
    it('matches same origin', () => {
      expect(isSameOrigin('https://example.com/a', 'https://example.com/b')).toBe(true);
    });
    it('differs by host', () => {
      expect(isSameOrigin('https://example.com/a', 'https://other.com/a')).toBe(false);
    });
    it('differs by scheme', () => {
      expect(isSameOrigin('http://example.com/a', 'https://example.com/a')).toBe(false);
    });
    it('differs by port', () => {
      expect(isSameOrigin('https://example.com:1/a', 'https://example.com:2/a')).toBe(false);
    });
    it('returns false for invalid URLs', () => {
      expect(isSameOrigin(':::', 'https://example.com')).toBe(false);
    });
  });

  describe('isPrivateAddress', () => {
    it('detects localhost', () => {
      expect(isPrivateAddress('http://localhost/path')).toBe(true);
      expect(isPrivateAddress('http://foo.localhost/path')).toBe(true);
    });
    it('detects loopback IPv4', () => {
      expect(isPrivateAddress('http://127.0.0.1/path')).toBe(true);
      expect(isPrivateAddress('http://127.1.2.3/path')).toBe(true);
    });
    it('detects 10/8 private range', () => {
      expect(isPrivateAddress('http://10.0.0.1/path')).toBe(true);
    });
    it('detects 192.168/16 private range', () => {
      expect(isPrivateAddress('http://192.168.1.1/path')).toBe(true);
    });
    it('detects 172.16/12 private range', () => {
      expect(isPrivateAddress('http://172.16.0.1/path')).toBe(true);
      expect(isPrivateAddress('http://172.31.255.255/path')).toBe(true);
    });
    it('does not flag 172.32 as private', () => {
      expect(isPrivateAddress('http://172.32.0.1/path')).toBe(false);
    });
    it('detects link-local 169.254/16', () => {
      expect(isPrivateAddress('http://169.254.1.1/path')).toBe(true);
    });
    it('detects ::1 and unique-local IPv6', () => {
      expect(isPrivateAddress('http://[::1]/path')).toBe(true);
      expect(isPrivateAddress('http://[fc00::1]/path')).toBe(true);
      expect(isPrivateAddress('http://[fd12::1]/path')).toBe(true);
    });
    it('detects IPv4-mapped IPv6 (loopback)', () => {
      expect(isPrivateAddress('http://[::ffff:127.0.0.1]/path')).toBe(true);
      expect(isPrivateAddress('http://[::ffff:7f00:1]/path')).toBe(true);
      expect(isPrivateAddress('http://[0:0:0:0:0:ffff:7f00:1]/path')).toBe(true);
    });
    it('detects IPv4-mapped IPv6 (private ranges)', () => {
      expect(isPrivateAddress('http://[::ffff:10.0.0.1]/path')).toBe(true);
      expect(isPrivateAddress('http://[::ffff:192.168.1.1]/path')).toBe(true);
      expect(isPrivateAddress('http://[::ffff:172.16.0.1]/path')).toBe(true);
    });
    it('does not flag IPv4-mapped public IPv6', () => {
      expect(isPrivateAddress('http://[::ffff:8.8.8.8]/path')).toBe(false);
      expect(isPrivateAddress('http://[::ffff:0808:0808]/path')).toBe(false);
    });
    it('detects the unspecified address ::', () => {
      expect(isPrivateAddress('http://[::]/path')).toBe(true);
    });
    it('detects 0.0.0.0/8', () => {
      expect(isPrivateAddress('http://0.0.0.0/path')).toBe(true);
      expect(isPrivateAddress('http://0.1.2.3/path')).toBe(true);
    });
    it('detects CGNAT 100.64/10', () => {
      expect(isPrivateAddress('http://100.64.0.1/path')).toBe(true);
      expect(isPrivateAddress('http://100.127.255.255/path')).toBe(true);
      expect(isPrivateAddress('http://100.128.0.1/path')).toBe(false);
    });
    it('detects documentation/benchmarking ranges', () => {
      expect(isPrivateAddress('http://192.0.2.1/path')).toBe(true); // TEST-NET-1
      expect(isPrivateAddress('http://198.51.100.1/path')).toBe(true); // TEST-NET-2
      expect(isPrivateAddress('http://203.0.113.1/path')).toBe(true); // TEST-NET-3
      expect(isPrivateAddress('http://198.18.0.1/path')).toBe(true); // benchmarking
      expect(isPrivateAddress('http://198.19.0.1/path')).toBe(true); // benchmarking
    });
    it('does not flag public addresses', () => {
      expect(isPrivateAddress('https://example.com/path')).toBe(false);
      expect(isPrivateAddress('http://93.184.216.34/path')).toBe(false);
    });
    it('treats invalid URLs as unsafe', () => {
      expect(isPrivateAddress(':::')).toBe(true);
    });
  });

  describe('urlKey', () => {
    it('produces stable dedupe keys', () => {
      expect(urlKey('https://example.com/a/')).toBe(urlKey('https://example.com/a'));
      expect(urlKey('https://example.com/a#x')).toBe(urlKey('https://example.com/a'));
    });
  });
});
