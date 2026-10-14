import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { startTestServer, defaultRoutes, type TestServer } from '../fixtures/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '..', '..', 'src', 'cli', 'index.ts');
const TSX = join(__dirname, '..', '..', 'node_modules', '.bin', 'tsx');

let server: TestServer;
let tmpDir: string;

beforeAll(async () => {
  server = await startTestServer(defaultRoutes());
  tmpDir = await mkdtemp(join(tmpdir(), 'scrapekit-cli-'));
});

afterAll(async () => {
  await server.close();
  await rm(tmpDir, { recursive: true, force: true });
});

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn('node', [TSX, CLI_PATH, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

describe('CLI end-to-end', () => {
  it('scrapekit --help exits 0 and lists commands', async () => {
    const r = await runCli(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('scrapekit');
    expect(r.stdout).toContain('inspect');
    expect(r.stdout).toContain('extract');
    expect(r.stdout).toContain('crawl');
  });

  it('scrapekit --version prints the version', async () => {
    const r = await runCli(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('0.1.0');
  });

  it('scrapekit inspect <url> prints structured metadata JSON', async () => {
    const r = await runCli([
      'inspect',
      `${server.url}/`,
      '--allow-private',
      '--timeout-ms',
      '4000',
    ]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.metadata.title).toBe('Example — ScrapeKit Fixture');
    expect(parsed.metadata.description).toBe('A small example page used by ScrapeKit tests.');
    expect(parsed.metadata.canonical).toBe('http://example.com/');
    expect(parsed.metadata.headings.h1).toContain('Welcome to the Example Page');
  });

  it('scrapekit extract --selector extracts matching text', async () => {
    const r = await runCli([
      'extract',
      `${server.url}/`,
      '--selector',
      'h1',
      '--allow-private',
      '--timeout-ms',
      '4000',
    ]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.selector).toBe('h1');
    expect(parsed.items.length).toBe(2);
    expect(parsed.items[0].text).toBe('Welcome to the Example Page');
  });

  it('scrapekit extract --selector a --attr href extracts links', async () => {
    const r = await runCli([
      'extract',
      `${server.url}/`,
      '--selector',
      'a',
      '--attr',
      'href',
      '--allow-private',
      '--format',
      'json',
      '--timeout-ms',
      '4000',
    ]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.attribute).toBe('href');
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.items.some((i: { attr?: string }) => i.attr?.includes('/about'))).toBe(true);
  });

  it('scrapekit extract with --format csv writes escaped CSV', async () => {
    const outFile = join(tmpDir, 'extract.csv');
    const r = await runCli([
      'extract',
      `${server.url}/`,
      '--selector',
      'meta[name="description"]',
      '--attr',
      'content',
      '--allow-private',
      '--format',
      'csv',
      '--output',
      outFile,
      '--timeout-ms',
      '4000',
    ]);
    expect(r.code).toBe(0);
    const content = await readFile(outFile, 'utf8');
    const lines = content.split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('url,selector,attribute,index,text,value');
    expect(lines.length).toBe(2);
    // The description value contains no special chars here.
    expect(lines[1]).toContain('A small example page used by ScrapeKit tests.');
  });

  it('scrapekit crawl writes JSON with crawled pages', async () => {
    const outFile = join(tmpDir, 'crawl.json');
    const r = await runCli([
      'crawl',
      `${server.url}/`,
      '--max-pages',
      '3',
      '--depth',
      '1',
      '--delay-ms',
      '5',
      '--concurrency',
      '2',
      '--allow-private',
      '--format',
      'json',
      '--output',
      outFile,
      '--timeout-ms',
      '4000',
    ]);
    expect(r.code).toBe(0);
    const content = await readFile(outFile, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.seed).toBe(`${server.url}/`);
    expect(parsed.pages.length).toBeGreaterThan(0);
    expect(parsed.visited).toBeGreaterThan(0);
  });

  it('scrapekit crawl --format csv produces a valid CSV with headers', async () => {
    const outFile = join(tmpDir, 'crawl.csv');
    const r = await runCli([
      'crawl',
      `${server.url}/`,
      '--max-pages',
      '2',
      '--depth',
      '0',
      '--delay-ms',
      '5',
      '--allow-private',
      '--format',
      'csv',
      '--output',
      outFile,
      '--timeout-ms',
      '4000',
    ]);
    expect(r.code).toBe(0);
    const content = await readFile(outFile, 'utf8');
    const lines = content.split('\r\n').filter(Boolean);
    expect(lines[0]).toContain('url,depth,status,title');
    expect(lines.length).toBe(2);
  });

  it('rejects an invalid URL with a non-zero exit code', async () => {
    const r = await runCli(['inspect', 'not-a-url', '--allow-private']);
    expect(r.code).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain('invalid url');
  });

  it('extract requires --selector', async () => {
    const r = await runCli(['extract', `${server.url}/`, '--allow-private']);
    // Commander exits with 1 when a required option is missing.
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('--selector');
  });

  it('refuses a private address by default', async () => {
    const r = await runCli(['inspect', 'http://127.0.0.1:1/', '--timeout-ms', '500']);
    expect(r.code).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain('private');
  });

  it('reports a file-write failure when the output path is not writable', async () => {
    // Create a regular file and attempt to write "inside" it as a directory,
    // which fails immediately with ENOTDIR rather than hanging on /proc.
    const blockingFile = join(tmpDir, 'a-regular-file');
    await writeFile(blockingFile, 'blocker');
    const badPath = join(blockingFile, 'output.json');
    const r = await runCli([
      'inspect',
      `${server.url}/`,
      '--allow-private',
      '--output',
      badPath,
      '--timeout-ms',
      '4000',
    ]);
    expect(r.code).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain('output');
  });

  it('rejects an invalid --format value (does not silently substitute json)', async () => {
    const r = await runCli([
      'inspect',
      `${server.url}/`,
      '--allow-private',
      '--format',
      'xml',
      '--timeout-ms',
      '4000',
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--format');
    expect(r.stderr.toLowerCase()).toContain('json');
  });

  it('rejects --concurrency 0 for crawl', async () => {
    const r = await runCli([
      'crawl',
      `${server.url}/`,
      '--concurrency',
      '0',
      '--allow-private',
      '--timeout-ms',
      '1000',
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--concurrency');
    expect(r.stderr).toContain('>= 1');
  });

  it('rejects --max-pages 0 for crawl', async () => {
    const r = await runCli(['crawl', `${server.url}/`, '--max-pages', '0', '--allow-private']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--max-pages');
  });

  it('rejects --timeout-ms 0', async () => {
    const r = await runCli(['inspect', `${server.url}/`, '--allow-private', '--timeout-ms', '0']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--timeout-ms');
  });

  it('rejects negative --delay-ms', async () => {
    const r = await runCli(['crawl', `${server.url}/`, '--delay-ms', '-5', '--allow-private']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--delay-ms');
  });

  it('rejects a non-numeric --concurrency', async () => {
    const r = await runCli(['crawl', `${server.url}/`, '--concurrency', 'abc', '--allow-private']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--concurrency');
  });

  it('handles Unicode content correctly in inspect metadata', async () => {
    const r = await runCli([
      'inspect',
      `${server.url}/`,
      '--allow-private',
      '--format',
      'json',
      '--timeout-ms',
      '4000',
    ]);
    expect(r.code).toBe(0);
    // The fixture <title> contains an em dash (—).
    expect(r.stdout).toContain('Example — ScrapeKit Fixture');
  });

  it('handles an empty result set gracefully', async () => {
    const r = await runCli([
      'extract',
      `${server.url}/`,
      '--selector',
      '.does-not-exist',
      '--allow-private',
      '--format',
      'json',
      '--timeout-ms',
      '4000',
    ]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.items).toEqual([]);
  });

  it('extract CSV with special characters is correctly escaped', async () => {
    // Build a fixture page with text containing commas, quotes, newlines.
    const { startTestServer } = await import('../fixtures/server.js');
    const special = await startTestServer({
      routes: {
        '/robots.txt': (_req, res) => {
          res.writeHead(200);
          res.end('User-agent: *\nAllow: /\n');
        },
        '/': (_req, res) => {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(
            '<html><body>' +
              '<p class="x">hello, world</p>' +
              '<p class="x">say "hi"</p>' +
              '<p class="x">line1\nline2</p>' +
              '</body></html>',
          );
        },
      },
    });
    try {
      const outFile = join(tmpDir, 'special.csv');
      const r = await runCli([
        'extract',
        `${special.url}/`,
        '--selector',
        '.x',
        '--allow-private',
        '--format',
        'csv',
        '--output',
        outFile,
        '--timeout-ms',
        '4000',
      ]);
      expect(r.code).toBe(0);
      const content = await readFile(outFile, 'utf8');
      const lines = content.split('\r\n');
      expect(lines[0]).toBe('url,selector,attribute,index,text,value');
      // Each special-character field must be quoted.
      expect(content).toContain('"hello, world"');
      expect(content).toContain('"say ""hi"""');
      expect(content).toContain('"line1\nline2"');
    } finally {
      await special.close();
    }
  });

  it('overwrites an existing output file', async () => {
    const outFile = join(tmpDir, 'overwrite.json');
    await writeFile(outFile, 'OLD CONTENT');
    const r = await runCli([
      'inspect',
      `${server.url}/`,
      '--allow-private',
      '--output',
      outFile,
      '--timeout-ms',
      '4000',
    ]);
    expect(r.code).toBe(0);
    const content = await readFile(outFile, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.metadata.title).toBe('Example — ScrapeKit Fixture');
    expect(content).not.toContain('OLD CONTENT');
  });
});
