/**
 * `scrapekit extract <url> --selector ... [--attr ...]` — extract elements
 * matching a CSS selector from a single public page.
 */
import type { Command } from 'commander';
import { fetchPage } from '../../core/client.js';
import { extractSelector, buildExtractionResult } from '../../core/extractor.js';
import { DEFAULT_USER_AGENT } from '../../core/fetcher.js';
import {
  failWithError,
  writeOutput,
  printSummary,
  parseFormat,
  parseNonNegInt,
  parsePosInt,
} from '../output.js';

export interface ExtractOptions {
  selector: string;
  attr?: string;
  format: 'json' | 'csv';
  output?: string;
  timeoutMs: number;
  userAgent: string;
  allowPrivate: boolean;
  maxRetries: number;
  maxBodyBytes: number;
}

export function registerExtractCommand(program: Command): void {
  program
    .command('extract')
    .description('Extract elements matching a CSS selector from a single public page.')
    .argument('<url>', 'Absolute http(s) URL to extract from.')
    .requiredOption(
      '-s, --selector <selector>',
      'CSS selector to match (e.g. "h1", "a", "article > p").',
    )
    .option(
      '-a, --attr <attribute>',
      'Extract this attribute (e.g. "href", "src") instead of text.',
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
        const options: ExtractOptions = {
          selector: String(opts.selector),
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

        const items = extractSelector(doc.body, options.selector, options.attr);
        const result = buildExtractionResult(doc.url, options.selector, items, options.attr);

        // For CSV, flatten items to rows.
        const csvRows = items.map((item) => ({
          url: result.url,
          selector: result.selector,
          attribute: result.attribute ?? '',
          index: item.index,
          text: item.text ?? '',
          value: item.attr ?? '',
        }));

        writeOutput(options.format === 'csv' ? csvRows : result, {
          format: options.format,
          output: options.output,
        });
        printSummary(
          `Extracted ${items.length} item${items.length === 1 ? '' : 's'} from ${doc.url} ` +
            `(HTTP ${doc.status}, ${attempts} attempt${attempts === 1 ? '' : 's'}).` +
            (options.output ? ` Output written to ${options.output}.` : ''),
        );
      } catch (err) {
        failWithError(err);
      }
    });
}
