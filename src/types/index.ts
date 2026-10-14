/**
 * ScrapeKit shared type definitions.
 *
 * These types describe the structured data produced by the extractor and
 * crawler, and the configuration accepted by the public API.
 */

/** A single extracted value from an HTML document. */
export interface ExtractedItem {
  /** The matched text content (trimmed) when text extraction was requested. */
  text?: string;
  /** The matched attribute value when attribute extraction was requested. */
  attr?: string;
  /** Zero-based index of the match within the selector result set. */
  index: number;
}

/** Result of an extraction operation against a single document. */
export interface ExtractionResult {
  /** The source URL the document was fetched from. */
  url: string;
  /** The CSS selector used for extraction. */
  selector: string;
  /** The attribute that was extracted, if any. */
  attribute?: string;
  /** The extracted items. */
  items: ExtractedItem[];
}

/** Structured metadata extracted from a single page. */
export interface PageMetadata {
  /** The source URL. */
  url: string;
  /** Final URL after redirects, if different from the request URL. */
  finalUrl?: string;
  /** HTTP status code of the response. */
  status: number;
  /** The <title> element text. */
  title: string | null;
  /** The <meta name="description"> content. */
  description: string | null;
  /** The <link rel="canonical"> href. */
  canonical: string | null;
  /** Heading texts grouped by level (h1..h6). */
  headings: Record<string, string[]>;
  /** Absolute internal links discovered on the page (same-origin). */
  internalLinks: string[];
  /** The fetched HTML body (only present when requested). */
  html?: string;
}

/** A crawled page and its extracted metadata. */
export interface CrawledPage {
  url: string;
  depth: number;
  status: number;
  metadata: PageMetadata | null;
  error?: string;
}

/** Result of a crawl run. */
export interface CrawlResult {
  /** The seed URL the crawl started from. */
  seed: string;
  /** All crawled pages in visitation order. */
  pages: CrawledPage[];
  /** Number of pages that were successfully fetched. */
  visited: number;
  /** Number of pages that were skipped (robots, depth, dedupe, errors). */
  skipped: number;
  /** Duration of the crawl in milliseconds. */
  durationMs: number;
}

/** Configuration for the HTTP fetcher. */
export interface FetcherOptions {
  /** Request timeout in milliseconds. Default: 15000. */
  timeoutMs?: number;
  /** Maximum number of redirects to follow. Default: 5. */
  maxRedirects?: number;
  /** Descriptive User-Agent string. */
  userAgent?: string;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Allow requests to private/loopback addresses. Default: false. */
  allowPrivateAddresses?: boolean;
}

/** Configuration for retry behaviour. */
export interface RetryOptions {
  /** Maximum number of retry attempts. Default: 3. */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 500. */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds. Default: 8000. */
  maxDelayMs?: number;
  /** Whether to respect a Retry-After header. Default: true. */
  respectRetryAfter?: boolean;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

/** Configuration for the crawler. */
export interface CrawlerOptions {
  /** Maximum number of pages to visit. Default: 10. */
  maxPages?: number;
  /** Maximum crawl depth (seed page is depth 0). Default: 2. */
  maxDepth?: number;
  /** Delay between requests to the same host in milliseconds. Default: 1000. */
  delayMs?: number;
  /** Maximum concurrent in-flight requests. Default: 2. */
  concurrency?: number;
  /** Whether to respect robots.txt. Default: true. */
  respectRobots?: boolean;
  /** Fetcher options forwarded to each request. */
  fetcher?: FetcherOptions;
  /** Retry options forwarded to each request. */
  retry?: RetryOptions;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Allow crawling private/loopback addresses (for local testing). Default: false. */
  allowPrivateAddresses?: boolean;
}

/** Output format for exports. */
export type ExportFormat = 'json' | 'csv';

/** Normalised fetch outcome used internally and by the crawler. */
export interface FetchedDocument {
  /** Final URL after redirects. */
  url: string;
  /** HTTP status code. */
  status: number;
  /** Response body as text. */
  body: string;
  /** Whether the response was a 429 rate-limit response. */
  rateLimited: boolean;
  /** Retry-After value in milliseconds, if present. */
  retryAfterMs?: number;
}

/** Error thrown when a fetch fails for a known reason. */
export class ScrapeKitError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = 'ScrapeKitError';
    this.code = code;
    this.status = status;
  }
}
