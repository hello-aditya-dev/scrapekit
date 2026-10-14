/**
 * `scrapekit extract <url> --selector ... [--attr ...]` — extract elements
 * matching a CSS selector from a single public page.
 */
import type { Command } from 'commander';
import { fetchPage } from '../../core/client.js';
import { extractSelector, buildExtractionResult } from '../../core/extractor.js';
import { DEFAULT_USER_AGENT } from '../../core/fetcher.js';
import type { ExportFormat } from '../../types/index.js';
import { failWithError, writeOutput, printSummary } from '../output.js';

export interface ExtractOptions {
  selector: string;
  attr?: string;
  format: ExportFormat;
  output?: string;
  timeoutMs: number;
  userAgent: string;
  allowPrivate: boolean;
  maxRetries: number;
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
    .action(async (url: string, opts: Record<string, string | boolean>) => {
      try {
        const format = (opts.format === 'csv' ? 'csv' : 'json') as ExportFormat;
        const options: ExtractOptions = {
          selector: String(opts.selector),
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

        writeOutput(format === 'csv' ? csvRows : result, { format, output: options.output });
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

function parsePositiveInt(value: unknown, fallback: number, flag: string): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    process.stderr.write(`Error: ${flag} must be a non-negative integer (got "${value}").\n`);
    process.exit(2);
  }
  return n;
}
