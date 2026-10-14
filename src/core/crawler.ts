/**
 * Conservative same-origin web crawler.
 *
 * Design goals:
 *  - Stay on the seed origin (same-origin only).
 *  - Respect robots.txt.
 *  - Bound work via maxPages, maxDepth, delayMs, concurrency.
 *  - Be polite: a single-host delay between successive requests.
 *  - Avoid private/loopback destinations unless explicitly allowed.
 *  - Graceful cancellation via AbortSignal.
 */
import type { CrawlResult, CrawledPage, CrawlerOptions, FetcherOptions } from '../types/index.js';
import { fetchPage } from './client.js';
import { extractMetadata } from './extractor.js';
import { loadRobots, isAllowed } from './robots.js';
import { isSameOrigin, normalizeUrl } from './url.js';
import { DEFAULT_USER_AGENT } from './fetcher.js';

interface QueueItem {
  url: string;
  depth: number;
}

const DEFAULTS: Required<
  Omit<CrawlerOptions, 'fetcher' | 'retry' | 'signal' | 'allowPrivateAddresses' | 'respectRobots'>
> = {
  maxPages: 10,
  maxDepth: 2,
  delayMs: 1000,
  concurrency: 2,
};

/**
 * Crawl a seed URL conservatively.
 *
 * The seed is always fetched (subject to robots.txt) at depth 0. Discovered
 * same-origin links are crawled up to `maxDepth` and `maxPages`.
 */
export async function crawl(seedUrl: string, options: CrawlerOptions = {}): Promise<CrawlResult> {
  const opts = { ...DEFAULTS, ...options };
  const seed = normalizeUrl(seedUrl);
  const fetcherOpts: FetcherOptions = {
    userAgent: options.fetcher?.userAgent ?? DEFAULT_USER_AGENT,
    allowPrivateAddresses: options.allowPrivateAddresses ?? false,
    signal: options.signal,
    ...options.fetcher,
  };

  const userAgent = fetcherOpts.userAgent ?? DEFAULT_USER_AGENT;
  const visited = new Set<string>();
  const pages: CrawledPage[] = [];
  const queue: QueueItem[] = [{ url: seed, depth: 0 }];
  let visitedCount = 0;
  let skipped = 0;
  let running = 0;
  const start = Date.now();

  // Single-host request spacing. Because we only crawl same-origin, a single
  // "nextAllowedTime" is sufficient to enforce politeness.
  let nextAllowedTime = 0;

  return new Promise<CrawlResult>((resolve) => {
    let resolved = false;
    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      resolve({
        seed,
        pages,
        visited: visitedCount,
        skipped,
        durationMs: Date.now() - start,
      });
    };

    const schedule = (): void => {
      if (opts.signal?.aborted) {
        if (running === 0) finish();
        return;
      }
      // Launch as many workers as concurrency allows, while there is work and
      // we have not yet hit the page budget.
      while (
        running < opts.concurrency &&
        queue.length > 0 &&
        visitedCount + running < opts.maxPages
      ) {
        const item = queue.shift();
        if (!item) break;
        if (item.depth > opts.maxDepth) {
          skipped++;
          continue;
        }
        const key = normalizeUrl(item.url);
        if (visited.has(key)) {
          skipped++;
          continue;
        }
        running++;
        void processItem(item).finally(() => {
          running--;
          if (running === 0) {
            // No in-flight work. Stop when there is nothing left to do, when
            // the page budget is spent, or when the crawl was cancelled.
            if (queue.length === 0 || visitedCount >= opts.maxPages || opts.signal?.aborted) {
              finish();
            } else {
              schedule();
            }
          } else if (queue.length > 0 && visitedCount < opts.maxPages) {
            schedule();
          }
        });
      }
      // If nothing is running and there is no schedulable work, we are done.
      if (running === 0 && (queue.length === 0 || visitedCount >= opts.maxPages)) {
        finish();
      }
    };

    async function processItem(item: QueueItem): Promise<void> {
      if (opts.signal?.aborted) return;
      if (visitedCount >= opts.maxPages) return;
      const key = normalizeUrl(item.url);
      if (visited.has(key)) {
        skipped++;
        return;
      }
      visited.add(key);

      // robots.txt check.
      if (options.respectRobots !== false) {
        try {
          const robots = await loadRobots(item.url, fetcherOpts, { userAgent });
          if (!isAllowed(robots, item.url, userAgent)) {
            pages.push({
              url: item.url,
              depth: item.depth,
              status: 0,
              metadata: null,
              error: 'blocked by robots.txt',
            });
            skipped++;
            return;
          }
        } catch {
          pages.push({
            url: item.url,
            depth: item.depth,
            status: 0,
            metadata: null,
            error: 'robots.txt unavailable',
          });
          skipped++;
          return;
        }
      }

      // Enforce polite delay between requests.
      const now = Date.now();
      if (now < nextAllowedTime) {
        await sleep(nextAllowedTime - now, opts.signal);
        if (opts.signal?.aborted) return;
      }
      nextAllowedTime = Date.now() + opts.delayMs;

      try {
        const { value: doc } = await fetchPage(item.url, fetcherOpts, options.retry ?? {});
        if (visitedCount >= opts.maxPages) {
          skipped++;
          return;
        }
        visitedCount++;
        const metadata = extractMetadata(doc.body, doc.url, {
          finalUrl: doc.url !== item.url ? doc.url : undefined,
          status: doc.status,
        });
        pages.push({ url: item.url, depth: item.depth, status: doc.status, metadata });

        // Enqueue same-origin children at depth + 1.
        if (item.depth < opts.maxDepth) {
          for (const link of metadata.internalLinks) {
            if (!isSameOrigin(link, seed)) continue;
            const childKey = normalizeUrl(link);
            if (visited.has(childKey)) continue;
            queue.push({ url: link, depth: item.depth + 1 });
          }
        }
      } catch (err) {
        pages.push({
          url: item.url,
          depth: item.depth,
          status: (err as { status?: number }).status ?? 0,
          metadata: null,
          error: (err as Error).message,
        });
        skipped++;
      }
    }

    schedule();
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
