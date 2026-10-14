/**
 * ScrapeKit — public library entry point.
 *
 * Extract useful data from public websites. Responsibly, reliably, and without
 * the boilerplate.
 *
 * This barrel re-exports the stable public API. Internal modules may be
 * imported directly but their shape is not guaranteed to be stable.
 */

// Core utilities
export { normalizeUrl, resolveUrl, isSameOrigin, isPrivateAddress, urlKey } from './core/url.js';

export { fetchDocument, parseRetryAfter, DEFAULT_USER_AGENT } from './core/fetcher.js';
export { fetchPage, isRetriableError, RetryableStatusError } from './core/client.js';
export { withRetry, computeBackoff, sleep } from './core/retry.js';
export { loadRobots, robotsUrlFor, isAllowed, clearRobotsCache } from './core/robots.js';
export {
  loadHtml,
  extractMetadata,
  extractSelector,
  extractInternalLinks,
  buildExtractionResult,
} from './core/extractor.js';
export { crawl } from './core/crawler.js';

// Exporters
export { toJson, writeJsonFile } from './exporters/json.js';
export { toCsv, writeCsvFile, escapeCsvField, escapeCsvRow } from './exporters/csv.js';

// Types and errors
export { ScrapeKitError } from './types/index.js';
export type {
  ExtractedItem,
  ExtractionResult,
  PageMetadata,
  CrawledPage,
  CrawlResult,
  FetcherOptions,
  RetryOptions,
  CrawlerOptions,
  ExportFormat,
  FetchedDocument,
} from './types/index.js';

export const VERSION = '0.1.0';
