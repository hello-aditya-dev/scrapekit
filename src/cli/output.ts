/**
 * Shared CLI helpers: output writing, summary printing, and argument parsing.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ScrapeKitError, type ExportFormat } from '../types/index.js';
import { toJson } from '../exporters/json.js';
import { toCsv } from '../exporters/csv.js';

export interface OutputOptions {
  format: ExportFormat;
  output?: string;
}

/**
 * Parse and strictly validate the --format option.
 *
 * Rejects unsupported values with a non-zero exit code instead of silently
 * substituting JSON.
 */
export function parseFormat(value: unknown): ExportFormat {
  if (value === 'json' || value === 'csv') return value;
  process.stderr.write(`Error: --format must be "json" or "csv" (got "${value}").\n`);
  process.exit(2);
}

/**
 * Parse a non-negative integer option. Exits with code 2 on invalid input.
 */
export function parseNonNegInt(
  value: unknown,
  fallback: number,
  flag: string,
  max?: number,
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    process.stderr.write(`Error: ${flag} must be a non-negative integer (got "${value}").\n`);
    process.exit(2);
  }
  if (max !== undefined && n > max) {
    process.stderr.write(`Error: ${flag} must be <= ${max} (got "${value}").\n`);
    process.exit(2);
  }
  return n;
}

/**
 * Parse a strictly positive integer option (>= 1). Exits with code 2 on invalid input.
 */
export function parsePosInt(value: unknown, fallback: number, flag: string, max?: number): number {
  const n = parseNonNegInt(value, fallback, flag, max);
  if (n < 1) {
    process.stderr.write(`Error: ${flag} must be >= 1 (got "${value}").\n`);
    process.exit(2);
  }
  return n;
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
