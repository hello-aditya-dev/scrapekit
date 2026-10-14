/**
 * `scrapekit crawl <url>` — crawl permitted same-origin pages within
 * conservative limits.
 */
import type { Command } from 'commander';
import { crawl } from '../../core/crawler.js';
import { DEFAULT_USER_AGENT } from '../../core/fetcher.js';
import {
  failWithError,
  writeOutput,
  printSummary,
  parseFormat,
  parseNonNegInt,
  parsePosInt,
} from '../output.js';

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  delayMs: number;
  concurrency: number;
  format: 'json' | 'csv';
  output?: string;
  timeoutMs: number;
  userAgent: string;
  allowPrivate: boolean;
  noRobots: boolean;
  maxRetries: number;
  maxBodyBytes: number;
}

export function registerCrawlCommand(program: Command): void {
  program
    .command('crawl')
    .description('Crawl permitted same-origin pages within conservative limits.')
    .argument('<url>', 'Seed absolute http(s) URL to crawl from.')
    .option('--max-pages <n>', 'Maximum number of pages to visit.', '10')
    .option('--depth <n>', 'Maximum crawl depth (seed page is depth 0).', '2')
    .option('--delay-ms <ms>', 'Delay between request starts to the same host (ms).', '1000')
    .option('--concurrency <n>', 'Maximum concurrent in-flight requests.', '2')
    .option('-f, --format <format>', 'Output format: json or csv.', 'json')
    .option('-o, --output <path>', 'Write output to a file instead of stdout.')
    .option('--timeout-ms <ms>', 'Per-request timeout in milliseconds.', '15000')
    .option('--user-agent <ua>', 'Override the User-Agent string.')
    .option('--allow-private', 'Allow crawling private/loopback addresses (local testing).', false)
    .option('--no-robots', 'Do not respect robots.txt (not recommended).')
    .option('--max-retries <n>', 'Maximum retry attempts for transient failures.', '3')
    .option('--max-body-bytes <n>', 'Maximum response body size in bytes.', String(5 * 1024 * 1024))
    .action(async (url: string, opts: Record<string, string | boolean>) => {
      try {
        const options: CrawlOptions = {
          maxPages: parsePosInt(opts.maxPages, 10, '--max-pages', 10_000),
          maxDepth: parseNonNegInt(opts.depth, 2, '--depth', 32),
          delayMs: parseNonNegInt(opts.delayMs, 1000, '--delay-ms', 3_600_000),
          concurrency: parsePosInt(opts.concurrency, 2, '--concurrency', 64),
          format: parseFormat(opts.format),
          output: typeof opts.output === 'string' ? opts.output : undefined,
          timeoutMs: parsePosInt(opts.timeoutMs, 15000, '--timeout-ms', 3_600_000),
          userAgent: typeof opts.userAgent === 'string' ? opts.userAgent : DEFAULT_USER_AGENT,
          allowPrivate: opts.allowPrivate === true,
          noRobots: opts.robots === false,
          maxRetries: parseNonNegInt(opts.maxRetries, 3, '--max-retries', 100),
          maxBodyBytes: parsePosInt(opts.maxBodyBytes, 5 * 1024 * 1024, '--max-body-bytes'),
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
            maxBodyBytes: options.maxBodyBytes,
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

        writeOutput(options.format === 'csv' ? csvRows : result, {
          format: options.format,
          output: options.output,
        });
        printSummary(
          `Crawled ${result.visited} page${result.visited === 1 ? '' : 's'} ` +
            `(${result.skipped} skipped, ${result.attempted} request${result.attempted === 1 ? '' : 's'} attempted) ` +
            `from ${result.seed} in ${result.durationMs}ms.` +
            (options.output ? ` Output written to ${options.output}.` : ''),
        );
      } catch (err) {
        failWithError(err);
      }
    });
}
