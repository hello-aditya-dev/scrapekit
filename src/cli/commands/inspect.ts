/**
 * `scrapekit inspect <url>` — fetch a single public page and print structured
 * metadata (title, description, canonical, headings, internal links).
 */
import type { Command } from 'commander';
import { fetchPage } from '../../core/client.js';
import { extractMetadata } from '../../core/extractor.js';
import { DEFAULT_USER_AGENT } from '../../core/fetcher.js';
import type { ExportFormat } from '../../types/index.js';
import { failWithError, writeOutput, printSummary } from '../output.js';

export interface InspectOptions {
  selector?: string;
  attr?: string;
  format: ExportFormat;
  output?: string;
  timeoutMs: number;
  userAgent: string;
  allowPrivate: boolean;
  maxRetries: number;
}

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect')
    .description('Fetch a single public page and print its structured metadata.')
    .argument('<url>', 'Absolute http(s) URL to inspect.')
    .option('-s, --selector <selector>', 'Also extract elements matching this CSS selector.')
    .option(
      '-a, --attr <attribute>',
      'Extract this attribute instead of text (use with --selector).',
    )
    .option('-f, --format <format>', 'Output format: json or csv.', 'json')
    .option('-o, --output <path>', 'Write output to a file instead of stdout.')
    .option('--timeout-ms <ms>', 'Request timeout in milliseconds.', '15000')
    .option('--user-agent <ua>', 'Override the User-Agent string.')
    .option('--allow-private', 'Allow fetching private/loopback addresses (local testing).', false)
    .option('--max-retries <n>', 'Maximum retry attempts for transient failures.', '3')
    .action(async (url: string, opts: Record<string, string | boolean>) => {
      try {
        const format = (opts.format === 'csv' ? 'csv' : 'json') as ExportFormat;
        const options: InspectOptions = {
          selector: typeof opts.selector === 'string' ? opts.selector : undefined,
          attr: typeof opts.attr === 'string' ? opts.attr : undefined,
          format,
          output: typeof opts.output === 'string' ? opts.output : undefined,
          timeoutMs: parsePositiveInt(opts.timeoutMs, 15000, '--timeout-ms'),
          userAgent: typeof opts.userAgent === 'string' ? opts.userAgent : DEFAULT_USER_AGENT,
          allowPrivate: opts.allowPrivate === true,
          maxRetries: parsePositiveInt(opts.maxRetries, 3, '--max-retries'),
        };

        const { value: doc, attempts } = await fetchPage(
          url,
          {
            timeoutMs: options.timeoutMs,
            userAgent: options.userAgent,
            allowPrivateAddresses: options.allowPrivate,
          },
          { maxRetries: options.maxRetries },
        );

        const metadata = extractMetadata(doc.body, doc.url, {
          finalUrl: doc.url !== url ? doc.url : undefined,
          status: doc.status,
        });

        const payload: Record<string, unknown> = { metadata };
        if (options.selector) {
          // Lazy import to avoid circular concerns; extractor is side-effect free.
          const { extractSelector } = await import('../../core/extractor.js');
          const items = extractSelector(doc.body, options.selector, options.attr);
          payload.extraction = {
            url: doc.url,
            selector: options.selector,
            attribute: options.attr,
            items,
          };
        }

        writeOutput(payload, { format, output: options.output });
        printSummary(
          `Inspected ${doc.url} (HTTP ${doc.status}, ${attempts} attempt${attempts === 1 ? '' : 's'}).` +
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
