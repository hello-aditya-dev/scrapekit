/**
 * `scrapekit inspect <url>` — fetch a single public page and print structured
 * metadata (title, description, canonical, headings, internal links).
 */
import type { Command } from 'commander';
import { fetchPage } from '../../core/client.js';
import { extractMetadata, extractSelector } from '../../core/extractor.js';
import { DEFAULT_USER_AGENT } from '../../core/fetcher.js';
import {
  failWithError,
  writeOutput,
  printSummary,
  parseFormat,
  parseNonNegInt,
  parsePosInt,
} from '../output.js';

export interface InspectOptions {
  selector?: string;
  attr?: string;
  format: 'json' | 'csv';
  output?: string;
  timeoutMs: number;
  userAgent: string;
  allowPrivate: boolean;
  maxRetries: number;
  maxBodyBytes: number;
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
    .option('--max-body-bytes <n>', 'Maximum response body size in bytes.', String(5 * 1024 * 1024))
    .action(async (url: string, opts: Record<string, string | boolean>) => {
      try {
        const options: InspectOptions = {
          selector: typeof opts.selector === 'string' ? opts.selector : undefined,
          attr: typeof opts.attr === 'string' ? opts.attr : undefined,
          format: parseFormat(opts.format),
          output: typeof opts.output === 'string' ? opts.output : undefined,
          timeoutMs: parsePosInt(opts.timeoutMs, 15000, '--timeout-ms', 3_600_000),
          userAgent: typeof opts.userAgent === 'string' ? opts.userAgent : DEFAULT_USER_AGENT,
          allowPrivate: opts.allowPrivate === true,
          maxRetries: parseNonNegInt(opts.maxRetries, 3, '--max-retries', 100),
          maxBodyBytes: parsePosInt(opts.maxBodyBytes, 5 * 1024 * 1024, '--max-body-bytes'),
        };

        const { value: doc, attempts } = await fetchPage(
          url,
          {
            timeoutMs: options.timeoutMs,
            userAgent: options.userAgent,
            allowPrivateAddresses: options.allowPrivate,
            maxBodyBytes: options.maxBodyBytes,
          },
          { maxRetries: options.maxRetries },
        );

        const metadata = extractMetadata(doc.body, doc.url, {
          finalUrl: doc.url !== url ? doc.url : undefined,
          status: doc.status,
        });

        const payload: Record<string, unknown> = { metadata };
        if (options.selector) {
          const items = extractSelector(doc.body, options.selector, options.attr);
          payload.extraction = {
            url: doc.url,
            selector: options.selector,
            attribute: options.attr,
            items,
          };
        }

        writeOutput(payload, { format: options.format, output: options.output });
        printSummary(
          `Inspected ${doc.url} (HTTP ${doc.status}, ${attempts} attempt${attempts === 1 ? '' : 's'}).` +
            (options.output ? ` Output written to ${options.output}.` : ''),
        );
      } catch (err) {
        failWithError(err);
      }
    });
}
