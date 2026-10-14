import { describe, it, expect } from 'vitest';
import { isPrivateIpString, checkDestination } from '../../src/core/ssrf.js';

describe('ssrf', () => {
  describe('isPrivateIpString', () => {
    it('detects IPv4 private ranges', () => {
      expect(isPrivateIpString('10.0.0.1')).toBe(true);
      expect(isPrivateIpString('172.16.0.1')).toBe(true);
      expect(isPrivateIpString('192.168.1.1')).toBe(true);
      expect(isPrivateIpString('169.254.1.1')).toBe(true);
      expect(isPrivateIpString('100.64.0.1')).toBe(true); // CGNAT
    });
    it('detects IPv4 loopback', () => {
      expect(isPrivateIpString('127.0.0.1')).toBe(true);
      expect(isPrivateIpString('127.255.255.255')).toBe(true);
    });
    it('detects 0.0.0.0/8', () => {
      expect(isPrivateIpString('0.0.0.0')).toBe(true);
      expect(isPrivateIpString('0.1.2.3')).toBe(true);
    });
    it('does not flag public IPv4', () => {
      expect(isPrivateIpString('8.8.8.8')).toBe(false);
      expect(isPrivateIpString('93.184.216.34')).toBe(false);
      expect(isPrivateIpString('172.32.0.1')).toBe(false);
    });
    it('detects IPv6 loopback, unique-local, link-local, unspecified', () => {
      expect(isPrivateIpString('::1')).toBe(true);
      expect(isPrivateIpString('::')).toBe(true);
      expect(isPrivateIpString('fc00::1')).toBe(true);
      expect(isPrivateIpString('fd12::1')).toBe(true);
      expect(isPrivateIpString('fe80::1')).toBe(true);
    });
    it('detects IPv4-mapped IPv6 (dotted form)', () => {
      expect(isPrivateIpString('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIpString('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateIpString('::ffff:192.168.1.1')).toBe(true);
      expect(isPrivateIpString('::ffff:8.8.8.8')).toBe(false);
    });
    it('detects IPv4-mapped IPv6 (hex form)', () => {
      expect(isPrivateIpString('::ffff:7f00:1')).toBe(true); // 127.0.0.1
      expect(isPrivateIpString('::ffff:0a00:1')).toBe(true); // 10.0.0.1
      expect(isPrivateIpString('::ffff:0808:0808')).toBe(false); // 8.8.8.8
    });
  });

  describe('checkDestination', () => {
    it('blocks IP literals directly (no DNS)', async () => {
      const r = await checkDestination('127.0.0.1');
      expect(r.allowed).toBe(false);
      expect(r.reason).toContain('private');
    });
    it('allows public IP literals', async () => {
      const r = await checkDestination('8.8.8.8');
      expect(r.allowed).toBe(true);
    });
    it('blocks localhost hostname without DNS', async () => {
      const r = await checkDestination('localhost');
      expect(r.allowed).toBe(false);
      expect(r.reason).toContain('localhost');
    });
    it('blocks *.localhost without DNS', async () => {
      const r = await checkDestination('foo.localhost');
      expect(r.allowed).toBe(false);
    });
    it('blocks hostnames that resolve to a private IP', async () => {
      const r = await checkDestination('internal.example', {
        lookupFn: async () => [{ address: '10.0.0.5', family: 4 }],
      });
      expect(r.allowed).toBe(false);
      expect(r.reason).toContain('10.0.0.5');
    });
    it('allows hostnames that resolve to public IPs', async () => {
      const r = await checkDestination('public.example', {
        lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
      });
      expect(r.allowed).toBe(true);
    });
    it('blocks when ANY resolved address is private', async () => {
      const r = await checkDestination('rebind.example', {
        lookupFn: async () => [
          { address: '127.0.0.1', family: 4 },
          { address: '93.184.216.34', family: 6 },
        ],
      });
      expect(r.allowed).toBe(false);
      expect(r.reason).toContain('127.0.0.1');
    });
    it('blocks when DNS resolution fails', async () => {
      const r = await checkDestination('nonexistent.invalid', {
        lookupFn: async () => {
          throw new Error('ENOTFOUND');
        },
      });
      expect(r.allowed).toBe(false);
      expect(r.reason).toContain('DNS resolution failed');
    });
    it('blocks when DNS returns no addresses', async () => {
      const r = await checkDestination('empty.example', {
        lookupFn: async () => [],
      });
      expect(r.allowed).toBe(false);
      expect(r.reason).toContain('no addresses');
    });
    it('skips the check entirely when allowPrivate is true', async () => {
      const r = await checkDestination('127.0.0.1', { allowPrivate: true });
      expect(r.allowed).toBe(true);
    });
    it('blocks IPv4-mapped IPv6 resolved addresses', async () => {
      const r = await checkDestination('mapped.example', {
        lookupFn: async () => [{ address: '::ffff:127.0.0.1', family: 6 }],
      });
      expect(r.allowed).toBe(false);
    });
  });
});
