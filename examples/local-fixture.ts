/**
 * ScrapeKit example — programmatic usage against a local fixture server.
 *
 * This example is fully self-contained and reproducible: it starts a tiny
 * local HTTP server, then uses the ScrapeKit library API to inspect, extract,
 * and crawl it. No third-party website is contacted.
 *
 * Run with:  npx tsx examples/local-fixture.ts
 */
import { createServer, type Server } from 'node:http';
import { fetchPage, extractMetadata, extractSelector, crawl, toJson } from '../src/index.js';

const HTML = `<!DOCTYPE html>
<html><head>
  <title>Demo Home</title>
  <meta name="description" content="A tiny demo site for ScrapeKit.">
  <link rel="canonical" href="http://demo.local/">
</head><body>
  <h1>Demo Home</h1>
  <p>Welcome. See the <a href="/about">about page</a> or the <a href="/contact">contact page</a>.</p>
</body></html>`;

const ABOUT = `<!DOCTYPE html>
<html><head><title>About — Demo</title></head><body>
  <h1>About</h1><p>Just a demo page. <a href="/">Home</a>.</p>
</body></html>`;

function startServer(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0]!;
      if (path === '/robots.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('User-agent: *\nAllow: /\n');
      } else if (path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(HTML);
      } else if (path === '/about') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(ABOUT);
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function main(): Promise<void> {
  const { server, url } = await startServer();
  try {
    console.log(`Demo server running at ${url}\n`);

    // 1) Inspect a single page.
    const { value: doc } = await fetchPage(`${url}/`, {
      allowPrivateAddresses: true,
    });
    const meta = extractMetadata(doc.body, doc.url, { status: doc.status });
    console.log('--- inspect ---');
    console.log(toJson({ metadata: meta }));

    // 2) Extract links.
    const links = extractSelector(doc.body, 'a', 'href');
    console.log('--- extract a[href] ---');
    console.log(toJson(links));

    // 3) Crawl same-origin pages.
    const result = await crawl(`${url}/`, {
      maxPages: 5,
      maxDepth: 1,
      delayMs: 50,
      concurrency: 2,
      allowPrivateAddresses: true,
    });
    console.log('--- crawl ---');
    console.log(
      toJson({
        visited: result.visited,
        skipped: result.skipped,
        durationMs: result.durationMs,
        pages: result.pages.map((p) => ({
          url: p.url,
          depth: p.depth,
          status: p.status,
          title: p.metadata?.title ?? null,
        })),
      }),
    );
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
