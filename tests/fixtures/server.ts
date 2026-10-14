/**
 * A minimal local HTTP server for ScrapeKit integration tests.
 *
 * Routes are configured at construction time and the server listens on an
 * ephemeral port. This keeps CI independent of third-party websites.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', 'fixtures');

export interface TestServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface RouteConfig {
  /** Path → handler. Handler may return { status, headers, body } or a string. */
  routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void | Promise<void>>;
  /** Optional fallback handler for unmatched paths. */
  fallback?: (req: IncomingMessage, res: ServerResponse) => void;
}

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

/** Build the default fixture routes for the example site. */
export function defaultRoutes(
  options: {
    robotsTxt?: string;
    extraRoutes?: Record<string, (req: IncomingMessage, res: ServerResponse) => void>;
  } = {},
): RouteConfig {
  const routes: RouteConfig['routes'] = {
    '/robots.txt': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(options.robotsTxt ?? 'User-agent: *\nAllow: /\n');
    },
    '/': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFixture('example.html'));
    },
    '/about': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFixture('about.html'));
    },
    '/about/': (_req, res) => {
      res.writeHead(301, { location: '/about' });
      res.end();
    },
    '/contact': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>Contact</title></head><body><h1>Contact</h1></body></html>');
    },
    '/500': (_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('server error');
    },
    ...options.extraRoutes,
  };
  return { routes };
}

/** Start a test server with the given route configuration. */
export async function startTestServer(config: RouteConfig): Promise<TestServer> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = req.url ?? '/';
      const path = url.split('?')[0]!;
      const handler = config.routes[path] ?? config.fallback;
      if (handler) {
        try {
          await handler(req, res);
        } catch (err) {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end(`Test server error: ${(err as Error).message}`);
        }
      } else {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
      });
    });
  });
}

export { readFixture };
