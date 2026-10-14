import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fetchDocument, parseRetryAfter } from '../../src/core/fetcher.js';
import { ScrapeKitError } from '../../src/types/index.js';
import { startTestServer, type TestServer, type RouteConfig } from '../fixtures/server.js';

let server: TestServer;

beforeAll(async () => {
  const config: RouteConfig = {
    routes: {
      '/robots.txt': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('User-agent: *\nAllow: /\n');
      },
      '/': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<html><head><title>Home</title></head><body><h1>Hi</h1></body></html>');
      },
      '/slow': (_req, res) => {
        setTimeout(() => {
          res.writeHead(200);
          res.end('late');
        }, 2000);
      },
      '/429': (_req, res) => {
        res.writeHead(429, { 'retry-after': '1' });
        res.end('rate limited');
      },
      '/redirect-to-private': (_req, res) => {
        res.writeHead(302, { location: 'http://127.0.0.1:9/admin' });
        res.end();
      },
      '/redirect-chain': (_req, res) => {
        res.writeHead(302, { location: '/redirect-chain-2' });
        res.end();
      },
      '/redirect-chain-2': (_req, res) => {
        res.writeHead(301, { location: '/redirect-final' });
        res.end();
      },
      '/redirect-final': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body>final</body></html>');
      },
      '/403': (_req, res) => {
        res.writeHead(403);
        res.end('forbidden');
      },
      '/500': (_req, res) => {
        res.writeHead(500);
        res.end('server error');
      },
    },
  };
  server = await startTestServer(config);
});

afterAll(async () => {
  await server.close();
});

describe('fetcher (integration)', () => {
  it('fetches a public page on the local fixture server', async () => {
    const doc = await fetchDocument(`${server.url}/`, { allowPrivateAddresses: true });
    expect(doc.status).toBe(200);
    expect(doc.body).toContain('<title>Home</title>');
    expect(doc.rateLimited).toBe(false);
  });

  it('follows a redirect chain to a final page', async () => {
    const doc = await fetchDocument(`${server.url}/redirect-chain`, {
      allowPrivateAddresses: true,
    });
    expect(doc.status).toBe(200);
    expect(doc.url.endsWith('/redirect-final')).toBe(true);
    expect(doc.body).toContain('final');
  });

  it('blocks redirects to private addresses (SSRF protection)', async () => {
    // A public seed must not be followed into a private/loopback address.
    // We stub global fetch so the public URL returns a 302 to 127.0.0.1, and
    // provide an ssrfChecker that allows the public host (so we reach the
    // redirect-handling path, where the private destination is blocked).
    const originalFetch = globalThis.fetch;
    const fakeFetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1:9/admin' },
        }),
    );
    globalThis.fetch = fakeFetch as unknown as typeof fetch;
    try {
      await expect(
        fetchDocument('https://public.example.com/page', {
          allowPrivateAddresses: false,
          ssrfChecker: async () => ({ allowed: true, reason: 'stub-allow' }),
        }),
      ).rejects.toMatchObject({ code: 'REDIRECT_TO_PRIVATE_ADDRESS' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('detects a 429 response and parses Retry-After', async () => {
    const doc = await fetchDocument(`${server.url}/429`, { allowPrivateAddresses: true });
    expect(doc.status).toBe(429);
    expect(doc.rateLimited).toBe(true);
    expect(doc.retryAfterMs).toBe(1000);
  });

  it('returns 4xx without throwing (caller decides)', async () => {
    const doc = await fetchDocument(`${server.url}/403`, { allowPrivateAddresses: true });
    expect(doc.status).toBe(403);
    expect(doc.body).toContain('forbidden');
  });

  it('returns 5xx without throwing (caller decides)', async () => {
    const doc = await fetchDocument(`${server.url}/500`, { allowPrivateAddresses: true });
    expect(doc.status).toBe(500);
  });

  it('times out and throws a TIMEOUT error', async () => {
    const start = Date.now();
    await expect(
      fetchDocument(`${server.url}/slow`, {
        allowPrivateAddresses: true,
        timeoutMs: 300,
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(Date.now() - start).toBeLessThan(1500);
  });

  it('refuses private addresses by default', async () => {
    await expect(fetchDocument('http://127.0.0.1:5/')).rejects.toMatchObject({
      code: 'BLOCKED_PRIVATE_ADDRESS',
    });
  });

  it('throws INVALID_URL for malformed URLs', async () => {
    await expect(fetchDocument('not-a-url')).rejects.toMatchObject({ code: 'INVALID_URL' });
  });

  it('rejects too many redirects', async () => {
    // Build a server that redirects in a loop and assert we cap it.
    const loop: RouteConfig = {
      routes: {
        '/loop': (_req, res) => {
          res.writeHead(302, { location: '/loop' });
          res.end();
        },
      },
    };
    const loopServer = await startTestServer(loop);
    try {
      await expect(
        fetchDocument(`${loopServer.url}/loop`, {
          allowPrivateAddresses: true,
          maxRedirects: 3,
        }),
      ).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' });
    } finally {
      await loopServer.close();
    }
  });

  it('rejects responses exceeding maxBodyBytes', async () => {
    const big: RouteConfig = {
      routes: {
        '/robots.txt': (_req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('User-agent: *\nAllow: /\n');
        },
        '/big': (_req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          // Write 64 KiB of data.
          res.end('A'.repeat(64 * 1024));
        },
      },
    };
    const bigServer = await startTestServer(big);
    try {
      await expect(
        fetchDocument(`${bigServer.url}/big`, {
          allowPrivateAddresses: true,
          maxBodyBytes: 1024,
        }),
      ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    } finally {
      await bigServer.close();
    }
  });

  it('accepts responses within maxBodyBytes', async () => {
    const small: RouteConfig = {
      routes: {
        '/robots.txt': (_req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('User-agent: *\nAllow: /\n');
        },
        '/small': (_req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('A'.repeat(500));
        },
      },
    };
    const smallServer = await startTestServer(small);
    try {
      const doc = await fetchDocument(`${smallServer.url}/small`, {
        allowPrivateAddresses: true,
        maxBodyBytes: 1024,
      });
      expect(doc.body.length).toBe(500);
    } finally {
      await smallServer.close();
    }
  });

  it('blocks hostnames that resolve to private addresses (DNS SSRF)', async () => {
    // Use the ssrfChecker hook to simulate a hostname resolving to 10.0.0.1.
    await expect(
      fetchDocument('https://internal.example/page', {
        allowPrivateAddresses: false,
        ssrfChecker: async () => ({
          allowed: false,
          reason: 'internal.example resolves to private address 10.0.0.1',
        }),
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED_PRIVATE_DESTINATION' });
  });

  it('distinguishes caller abort from timeout', async () => {
    const controller = new AbortController();
    const slowP = fetchDocument(`${server.url}/slow`, {
      allowPrivateAddresses: true,
      timeoutMs: 5000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    await expect(slowP).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('blocks IPv4-mapped IPv6 loopback redirects', async () => {
    const originalFetch = globalThis.fetch;
    const fakeFetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://[::ffff:127.0.0.1]/admin' },
        }),
    );
    globalThis.fetch = fakeFetch as unknown as typeof fetch;
    try {
      await expect(
        fetchDocument('https://public.example/page', {
          allowPrivateAddresses: false,
          ssrfChecker: async () => ({ allowed: true, reason: 'stub-allow' }),
        }),
      ).rejects.toMatchObject({ code: 'REDIRECT_TO_PRIVATE_ADDRESS' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('0')).toBe(0);
  });
  it('parses HTTP-date into a future millisecond delta', () => {
    const future = new Date(Date.now() + 10_000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).toBeTypeOf('number');
    expect(ms).toBeGreaterThan(5000);
  });
  it('returns undefined for invalid input', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('not a date or number')).toBeUndefined();
  });
});

// Keep ScrapeKitError import used.
void ScrapeKitError;
