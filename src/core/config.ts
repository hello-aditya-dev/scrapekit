/**
 * Shared configuration validation for the crawler, fetcher, and CLI.
 *
 * Centralizing these checks guarantees that invalid values are rejected at the
 * boundary (CLI argument parsing or public API entry) rather than producing
 * silent no-ops, deadlocks, or undefined behavior deep inside the scheduler.
 */
import {
  ScrapeKitError,
  type CrawlerOptions,
  type FetcherOptions,
  type RetryOptions,
} from '../types/index.js';

export interface ValidatedCrawlerOptions extends Required<
  Pick<
    CrawlerOptions,
    'maxPages' | 'maxDepth' | 'delayMs' | 'concurrency' | 'respectRobots' | 'allowPrivateAddresses'
  >
> {
  fetcher?: FetcherOptions;
  retry?: RetryOptions;
  signal?: AbortSignal;
}

export interface ValidatedFetcherOptions {
  timeoutMs: number;
  maxRedirects: number;
  userAgent: string;
  signal?: AbortSignal;
  allowPrivateAddresses: boolean;
  maxBodyBytes?: number;
}

export interface ValidatedRetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  respectRetryAfter: boolean;
  signal?: AbortSignal;
}

/** Assert that a value is a non-negative finite integer. */
function assertNonNegInt(value: unknown, name: string, max?: number): number {
  if (value === undefined || value === null) {
    throw new ScrapeKitError(`${name} is required.`, 'INVALID_CONFIG');
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new ScrapeKitError(
      `${name} must be a non-negative integer (got ${JSON.stringify(value)}).`,
      'INVALID_CONFIG',
    );
  }
  if (max !== undefined && value > max) {
    throw new ScrapeKitError(`${name} must be <= ${max} (got ${value}).`, 'INVALID_CONFIG');
  }
  return value;
}

/** Assert that a value is a positive finite integer (>= 1). */
function assertPosInt(value: unknown, name: string, max?: number): number {
  const n = assertNonNegInt(value, name, max);
  if (n < 1) {
    throw new ScrapeKitError(`${name} must be >= 1 (got ${value}).`, 'INVALID_CONFIG');
  }
  return n;
}

/** Validate crawler options and return a fully-populated, normalized config. */
export function validateCrawlerOptions(
  seedUrl: string,
  options: CrawlerOptions = {},
): ValidatedCrawlerOptions {
  if (typeof seedUrl !== 'string' || seedUrl.trim() === '') {
    throw new ScrapeKitError('A non-empty seed URL is required.', 'INVALID_CONFIG');
  }
  const maxPages = options.maxPages ?? 10;
  const maxDepth = options.maxDepth ?? 2;
  const delayMs = options.delayMs ?? 1000;
  const concurrency = options.concurrency ?? 2;
  assertPosInt(maxPages, 'maxPages', 10_000);
  assertNonNegInt(maxDepth, 'maxDepth', 32);
  assertNonNegInt(delayMs, 'delayMs', 3_600_000);
  assertPosInt(concurrency, 'concurrency', 64);
  const result: ValidatedCrawlerOptions = {
    maxPages,
    maxDepth,
    delayMs,
    concurrency,
    respectRobots: options.respectRobots ?? true,
    allowPrivateAddresses: options.allowPrivateAddresses ?? false,
  };
  if (options.fetcher) {
    result.fetcher = options.fetcher;
  }
  if (options.retry) {
    result.retry = options.retry;
  }
  if (options.signal) {
    result.signal = options.signal;
  }
  return result;
}

/** Validate fetcher options and return a fully-populated, normalized config. */
export function validateFetcherOptions(options: FetcherOptions = {}): ValidatedFetcherOptions {
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxRedirects = options.maxRedirects ?? 5;
  const userAgent = options.userAgent ?? 'ScrapeKit';
  assertPosInt(timeoutMs, 'timeoutMs', 3_600_000);
  assertNonNegInt(maxRedirects, 'maxRedirects', 20);
  if (typeof userAgent !== 'string' || userAgent.trim() === '') {
    throw new ScrapeKitError('userAgent must be a non-empty string.', 'INVALID_CONFIG');
  }
  const result: ValidatedFetcherOptions = {
    timeoutMs,
    maxRedirects,
    userAgent,
    allowPrivateAddresses: options.allowPrivateAddresses ?? false,
  };
  if (options.signal) result.signal = options.signal;
  if (options.maxBodyBytes !== undefined) {
    result.maxBodyBytes = assertNonNegInt(
      options.maxBodyBytes,
      'maxBodyBytes',
      Number.MAX_SAFE_INTEGER,
    );
  }
  return result;
}

/** Validate retry options and return a fully-populated, normalized config. */
export function validateRetryOptions(options: RetryOptions = {}): ValidatedRetryOptions {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  assertNonNegInt(maxRetries, 'maxRetries', 100);
  assertNonNegInt(baseDelayMs, 'baseDelayMs', 3_600_000);
  assertNonNegInt(maxDelayMs, 'maxDelayMs', 3_600_000);
  if (baseDelayMs > maxDelayMs) {
    throw new ScrapeKitError(
      `baseDelayMs (${baseDelayMs}) must be <= maxDelayMs (${maxDelayMs}).`,
      'INVALID_CONFIG',
    );
  }
  const result: ValidatedRetryOptions = {
    maxRetries,
    baseDelayMs,
    maxDelayMs,
    respectRetryAfter: options.respectRetryAfter ?? true,
  };
  if (options.signal) result.signal = options.signal;
  return result;
}
