/**
 * Shared CLI helpers: output writing and summary printing.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ScrapeKitError } from '../types/index.js';
import { toJson } from '../exporters/json.js';
import { toCsv } from '../exporters/csv.js';
import type { ExportFormat } from '../types/index.js';

export interface OutputOptions {
  format: ExportFormat;
  output?: string;
}

/**
 * Serialize `data` according to `format` and either write it to `output`
 * (a file path) or print it to stdout.
 *
 * Throws a ScrapeKitError (code "OUTPUT_ERROR") on file-writing failures.
 */
export function writeOutput(data: unknown, options: OutputOptions): void {
  const content =
    options.format === 'csv'
      ? toCsv(Array.isArray(data) ? (data as Record<string, unknown>[]) : [wrapRecord(data)])
      : toJson(data);

  if (options.output) {
    try {
      mkdirSync(dirname(options.output), { recursive: true });
      writeFileSync(options.output, content, 'utf8');
    } catch (err) {
      throw new ScrapeKitError(
        `Failed to write output file "${options.output}": ${err instanceof Error ? err.message : String(err)}`,
        'OUTPUT_ERROR',
      );
    }
  } else {
    process.stdout.write(content);
  }
}

function wrapRecord(data: unknown): Record<string, unknown> {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { value: data };
}

/** Print a short human-readable summary to stderr (so stdout stays clean). */
export function printSummary(message: string): void {
  process.stderr.write(message + '\n');
}

/** Exit with a ScrapeKit error, printing a readable message to stderr. */
export function failWithError(err: unknown): never {
  if (err instanceof ScrapeKitError) {
    process.stderr.write(`Error [${err.code}]: ${err.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exit(1);
}
