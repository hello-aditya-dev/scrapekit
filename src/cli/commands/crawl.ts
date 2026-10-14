/**
 * `scrapekit crawl <url>` — crawl permitted same-origin pages within
 * conservative limits.
 */
import type { Command } from 'commander';
import { crawl } from '../../core/crawler.js';
import { DEFAULT_USER_AGENT } from '../../core/fetcher.js';
import type { ExportFormat } from '../../types/index.js';
import { failWithError, writeOutput, printSummary } from '../output.js';

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  delayMs: number;
  concurrency: number;
  format: ExportFormat;
  output?: string;
  timeoutMs: number;
  userAgent: string;
  allowPrivate: boolean;
  noRobots: boolean;
  maxRetries: number;
}

export function registerCrawlCommand(program: Command): void {
  program
    .command('crawl')
    .description('Crawl permitted same-origin pages within conservative limits.')
    .argument('<url>', 'Seed absolute http(s) URL to crawl from.')
    .option('--max-pages <n>', 'Maximum number of pages to visit.', '10')
    .option('--depth <n>', 'Maximum crawl depth (seed page is depth 0).', '2')
    .option('--delay-ms <ms>', 'Delay between requests to the same host (ms).', '1000')
    .option('--concurrency <n>', 'Maximum concurrent in-flight requests.', '2')
    .option('-f, --format <format>', 'Output format: json or csv.', 'json')
    .option('-o, --output <path>', 'Write output to a file instead of stdout.')
    .option('--timeout-ms <ms>', 'Per-request timeout in milliseconds.', '15000')
    .option('--user-agent <ua>', 'Override the User-Agent string.')
    .option('--allow-private', 'Allow crawling private/loopback addresses (local testing).', false)
    .option('--no-robots', 'Do not respect robots.txt (not recommended).')
    .option('--max-retries <n>', 'Maximum retry attempts for transient failures.', '3')
    .action(async (url: string, opts: Record<string, string | boolean>) => {
      try {
        const format = (opts.format === 'csv' ? 'csv' : 'json') as ExportFormat;
        const options: CrawlOptions = {
          maxPages: parsePositiveInt(opts.maxPages, 10, '--max-pages'),
          maxDepth: parsePositiveInt(opts.depth, 2, '--depth'),
          delayMs: parsePositiveInt(opts.delayMs, 1000, '--delay-ms'),
          concurrency: parsePositiveInt(opts.concurrency, 2, '--concurrency'),
          format,
          output: typeof opts.output === 'string' ? opts.output : undefined,
          timeoutMs: parsePositiveInt(opts.timeoutMs, 15000, '--timeout-ms'),
          userAgent: typeof opts.userAgent === 'string' ? opts.userAgent : DEFAULT_USER_AGENT,
          allowPrivate: opts.allowPrivate === true,
          noRobots: opts.robots === false,
          maxRetries: parsePositiveInt(opts.maxRetries, 3, '--max-retries'),
        };

        const result = await crawl(url, {
          maxPages: options.maxPages,
          maxDepth: options.maxDepth,
          delayMs: options.delayMs,
          concurrency: options.concurrency,
          respectRobots: !options.noRobots,
          allowPrivateAddresses: options.allowPrivate,
          fetcher: {
            timeoutMs: options.timeoutMs,
            userAgent: options.userAgent,
            allowPrivateAddresses: options.allowPrivate,
          },
          retry: { maxRetries: options.maxRetries },
        });

        // For CSV, emit one row per crawled page with predictable columns.
        const csvRows = result.pages.map((p) => ({
          url: p.url,
          depth: p.depth,
          status: p.status,
          title: p.metadata?.title ?? '',
          description: p.metadata?.description ?? '',
          canonical: p.metadata?.canonical ?? '',
          headingCount: Object.values(p.metadata?.headings ?? {}).reduce((n, h) => n + h.length, 0),
          internalLinks: p.metadata?.internalLinks.length ?? 0,
          error: p.error ?? '',
        }));

        writeOutput(format === 'csv' ? csvRows : result, { format, output: options.output });
        printSummary(
          `Crawled ${result.visited} page${result.visited === 1 ? '' : 's'} ` +
            `(${result.skipped} skipped) from ${result.seed} in ${result.durationMs}ms.` +
            (options.output ? ` Output written to ${options.output}.` : ''),
        );
      } catch (err) {
        failWithError(err);
      }
    });
}

function parsePositiveInt(value: unknown, fallback: number, flag: string): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    process.stderr.write(`Error: ${flag} must be a non-negative integer (got "${value}").\n`);
    process.exit(2);
  }
  return n;
}
