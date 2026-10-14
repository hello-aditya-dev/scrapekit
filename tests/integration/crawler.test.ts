import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { crawl } from '../../src/core/crawler.js';
import { fetchPage } from '../../src/core/client.js';
import { isRetriableError, RetryableStatusError } from '../../src/core/client.js';
import { ScrapeKitError } from '../../src/types/index.js';
import {
  startTestServer,
  defaultRoutes,
  type TestServer,
  type RouteConfig,
} from '../fixtures/server.js';

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer(defaultRoutes());
});

afterAll(async () => {
  await server.close();
});

describe('crawler (integration)', () => {
  it('crawls the seed page and same-origin links', async () => {
    const result = await crawl(`${server.url}/`, {
      maxPages: 5,
      maxDepth: 1,
      delayMs: 10,
      concurrency: 2,
      allowPrivateAddresses: true,
      fetcher: { timeoutMs: 3000 },
    });
    expect(result.visited).toBeGreaterThan(0);
    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain(`${server.url}/`);
    expect(urls).toContain(`${server.url}/about`);
    expect(urls).toContain(`${server.url}/contact`);
  });

  it('enforces maxPages', async () => {
    const result = await crawl(`${server.url}/`, {
      maxPages: 2,
      maxDepth: 3,
      delayMs: 5,
      concurrency: 1,
      allowPrivateAddresses: true,
    });
    expect(result.visited).toBeLessThanOrEqual(2);
    expect(result.pages.length).toBeLessThanOrEqual(2 + result.skipped);
  });

  it('enforces maxDepth (does not visit depth+1 pages)', async () => {
    // With maxDepth 0, only the seed is fetched even though it links to /about.
    const result = await crawl(`${server.url}/`, {
      maxPages: 10,
      maxDepth: 0,
      delayMs: 5,
      concurrency: 1,
      allowPrivateAddresses: true,
    });
    expect(result.visited).toBe(1);
    expect(result.pages.map((p) => p.url)).toEqual([`${server.url}/`]);
  });

  it('deduplicates URLs', async () => {
    // The example page links to /about multiple ways; the crawler must visit it once.
    const result = await crawl(`${server.url}/`, {
      maxPages: 10,
      maxDepth: 1,
      delayMs: 5,
      concurrency: 1,
      allowPrivateAddresses: true,
    });
    const aboutCount = result.pages.filter((p) => p.url === `${server.url}/about`).length;
    expect(aboutCount).toBe(1);
  });

  it('respects robots.txt disallow rules', async () => {
    const localServer = await startTestServer(
      defaultRoutes({
        robotsTxt: 'User-agent: *\nDisallow: /about\n',
      }),
    );
    try {
      const result = await crawl(`${localServer.url}/`, {
        maxPages: 10,
        maxDepth: 1,
        delayMs: 5,
        concurrency: 1,
        allowPrivateAddresses: true,
      });
      const about = result.pages.find((p) => p.url === `${localServer.url}/about`);
      // /about must either not be visited, or be recorded as blocked.
      if (about) {
        expect(about.error).toContain('robots.txt');
        expect(about.metadata).toBeNull();
      }
      const visitedAbout = result.pages.find(
        (p) => p.url === `${localServer.url}/about` && p.metadata !== null,
      );
      expect(visitedAbout).toBeUndefined();
    } finally {
      await localServer.close();
    }
  });

  it('records error metadata for failed pages without crashing', async () => {
    const broken: RouteConfig = defaultRoutes({
      extraRoutes: {
        '/boom': (_req, res) => {
          res.writeHead(500);
          res.end('boom');
        },
      },
    });
    broken.routes['/'] = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body><a href="/boom">boom</a><a href="/about">about</a></body></html>');
    };
    const localServer = await startTestServer(broken);
    try {
      const result = await crawl(`${localServer.url}/`, {
        maxPages: 10,
        maxDepth: 1,
        delayMs: 5,
        concurrency: 1,
        allowPrivateAddresses: true,
        retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 2 },
      });
      const boom = result.pages.find((p) => p.url === `${localServer.url}/boom`);
      expect(boom).toBeDefined();
      expect(boom?.error).toBeDefined();
      expect(boom?.status).toBe(500);
    } finally {
      await localServer.close();
    }
  });

  it('does not crawl external origins', async () => {
    const result = await crawl(`${server.url}/`, {
      maxPages: 10,
      maxDepth: 2,
      delayMs: 5,
      concurrency: 1,
      allowPrivateAddresses: true,
    });
    const external = result.pages.find((p) => !p.url.startsWith(server.url));
    expect(external).toBeUndefined();
  });

  it('rejects concurrency 0 with INVALID_CONFIG', async () => {
    await expect(
      crawl(`${server.url}/`, {
        concurrency: 0,
        allowPrivateAddresses: true,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('rejects negative concurrency', async () => {
    await expect(
      crawl(`${server.url}/`, {
        concurrency: -1,
        allowPrivateAddresses: true,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('rejects maxPages 0', async () => {
    await expect(
      crawl(`${server.url}/`, {
        maxPages: 0,
        allowPrivateAddresses: true,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('enforces request spacing across concurrent workers', async () => {
    // A page with many same-origin children so multiple workers compete.
    const manyLinks: RouteConfig = defaultRoutes();
    manyLinks.routes['/'] = (_req, res) => {
      let body = '<html><body>';
      for (let i = 0; i < 8; i++) body += `<a href="/p${i}">p${i}</a>`;
      body += '</body></html>';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    };
    for (let i = 0; i < 8; i++) {
      const idx = i;
      manyLinks.routes[`/p${idx}`] = (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<html><body><h1>p${idx}</h1></body></html>`);
      };
    }
    const localServer = await startTestServer(manyLinks);
    const timestamps: number[] = [];
    const original = localServer;
    // Wrap by intercepting via a custom route: we re-create server with a
    // handler that records timestamps.
    await localServer.close();
    const recordingServer = await startTestServer({
      routes: Object.fromEntries(
        Object.entries(manyLinks.routes).map(([path, _h]) => [
          path,
          (_req, res) => {
            if (path === '/robots.txt') {
              res.writeHead(200);
              res.end('User-agent: *\nAllow: /\n');
              return;
            }
            timestamps.push(Date.now());
            if (path === '/') {
              let body = '<html><body>';
              for (let i = 0; i < 8; i++) body += `<a href="/p${i}">p${i}</a>`;
              body += '</body></html>';
              res.writeHead(200, { 'content-type': 'text/html' });
              res.end(body);
            } else {
              res.writeHead(200, { 'content-type': 'text/html' });
              res.end(`<html><body><h1>${path}</h1></body></html>`);
            }
          },
        ]),
      ),
    });
    void original;
    try {
      const DELAY = 120;
      const result = await crawl(`${recordingServer.url}/`, {
        maxPages: 9,
        maxDepth: 1,
        delayMs: DELAY,
        concurrency: 4,
        allowPrivateAddresses: true,
        fetcher: { timeoutMs: 3000 },
      });
      expect(result.visited).toBe(9);
      // Sort timestamps and verify minimum gap between consecutive requests.
      const sorted = [...timestamps].sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i]! - sorted[i - 1]!);
      const minGap = Math.min(...gaps);
      // Tolerate ~40ms of scheduling jitter; the bug produced 0–5ms gaps.
      expect(minGap).toBeGreaterThanOrEqual(DELAY - 50);
    } finally {
      await recordingServer.close();
    }
  });

  it('cancels gracefully via AbortSignal', async () => {
    const slow: RouteConfig = defaultRoutes({
      extraRoutes: {
        '/slow-page': (_req, res) => {
          setTimeout(() => {
            res.writeHead(200);
            res.end('<html></html>');
          }, 3000);
        },
      },
    });
    slow.routes['/'] = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body><a href="/slow-page">slow</a></body></html>');
    };
    const localServer = await startTestServer(slow);
    try {
      const controller = new AbortController();
      const crawlP = crawl(`${localServer.url}/`, {
        maxPages: 5,
        maxDepth: 1,
        delayMs: 5,
        concurrency: 1,
        allowPrivateAddresses: true,
        signal: controller.signal,
        fetcher: { timeoutMs: 5000 },
      });
      // Abort shortly after the seed fetch begins.
      setTimeout(() => controller.abort(), 200);
      const result = await crawlP;
      // The crawl must resolve (not hang) and report partial results.
      expect(result.durationMs).toBeLessThan(5000);
    } finally {
      await localServer.close();
    }
  });

  it('reports attempted count in the result', async () => {
    const result = await crawl(`${server.url}/`, {
      maxPages: 3,
      maxDepth: 1,
      delayMs: 5,
      concurrency: 2,
      allowPrivateAddresses: true,
    });
    expect(result.attempted).toBeGreaterThan(0);
    expect(result.attempted).toBeGreaterThanOrEqual(result.visited);
  });
});

describe('client (integration)', () => {
  it('fetchPage returns a 2xx document', async () => {
    const { value: doc } = await fetchPage(`${server.url}/`, {
      allowPrivateAddresses: true,
    });
    expect(doc.status).toBe(200);
  });

  it('fetchPage throws a RetryableStatusError for 500 (after retries)', async () => {
    await expect(
      fetchPage(
        `${server.url}/500`,
        { allowPrivateAddresses: true },
        { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 2 },
      ),
    ).rejects.toMatchObject({ status: 500 });
  });

  it('isRetriableError classifies 429 and 5xx as retriable', () => {
    expect(isRetriableError(new RetryableStatusError(429, 'x'))).toBe(true);
    expect(isRetriableError(new RetryableStatusError(503, 'x'))).toBe(true);
    expect(isRetriableError(new ScrapeKitError('t', 'TIMEOUT'))).toBe(true);
    expect(isRetriableError(new ScrapeKitError('t', 'NETWORK_ERROR'))).toBe(true);
    expect(isRetriableError(new ScrapeKitError('forbidden', 'HTTP_ERROR', 403))).toBe(false);
    expect(isRetriableError(new Error('generic'))).toBe(false);
  });
});
