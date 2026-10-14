/**
 * Conservative same-origin web crawler.
 *
 * Design goals:
 *  - Stay on the seed origin (same-origin only).
 *  - Respect robots.txt.
 *  - Bound work via maxPages, maxDepth, delayMs, concurrency.
 *  - Be polite: enforce a minimum spacing between request *starts* to the same
 *    host, even under concurrency (via an async gate).
 *  - Avoid private/loopback destinations unless explicitly allowed.
 *  - Graceful cancellation via AbortSignal.
 *  - Accurate statistics and deterministic page ordering.
 */
import type { CrawlResult, CrawledPage, CrawlerOptions, FetcherOptions } from '../types/index.js';
import { fetchPage } from './client.js';
import { extractMetadata } from './extractor.js';
import { loadRobots, isAllowed } from './robots.js';
import { isSameOrigin, normalizeUrl } from './url.js';
import { DEFAULT_USER_AGENT } from './fetcher.js';
import { validateCrawlerOptions } from './config.js';

interface QueueItem {
  url: string;
  depth: number;
}

/**
 * An async gate that enforces minimum spacing between request starts.
 *
 * Workers call `acquire()` before issuing a request. The gate resolves only
 * when at least `delayMs` has elapsed since the previous acquire, ensuring
 * requests are spaced even under concurrency. A waiting queue (FIFO) guarantees
 * ordering and avoids a thundering-herd race on the shared timestamp.
 */
class RateGate {
  private nextAllowedTime = 0;
  private waiters: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly delayMs: number,
    private readonly signal?: AbortSignal,
  ) {}

  async acquire(): Promise<void> {
    // If the gate is free, claim it immediately.
    if (this.waiters.length === 0 && Date.now() >= this.nextAllowedTime) {
      this.nextAllowedTime = Date.now() + this.delayMs;
      return;
    }
    // Otherwise queue and wait for our turn.
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const idx = this.waiters.indexOf(resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error('Aborted'));
      };
      if (this.signal?.aborted) {
        onAbort();
        return;
      }
      this.waiters.push(resolve);
      this.signal?.addEventListener('abort', onAbort, { once: true });
      this.scheduleDrain();
    });
  }

  private scheduleDrain(): void {
    if (this.timer) return;
    const wait = Math.max(0, this.nextAllowedTime - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, wait);
    // NOTE: Do NOT unref this timer. The crawler's outer Promise resolves only
    // when all workers finish; if the rate-gate timer were unref'd, Node could
    // exit the event loop while workers are still waiting for their turn,
    // causing a silent no-op exit. Keeping the timer ref'd ensures the process
    // stays alive until the crawl completes or is aborted.
  }

  private drain(): void {
    if (this.waiters.length === 0) return;
    if (Date.now() < this.nextAllowedTime) {
      this.scheduleDrain();
      return;
    }
    // Release exactly one waiter (FIFO) and advance the next-allowed time.
    const next = this.waiters.shift();
    if (next) {
      this.nextAllowedTime = Date.now() + this.delayMs;
      next();
    }
    if (this.waiters.length > 0) this.scheduleDrain();
  }
}

/**
 * Crawl a seed URL conservatively.
 *
 * The seed is always fetched (subject to robots.txt) at depth 0. Discovered
 * same-origin links are crawled up to `maxDepth` and `maxPages`.
 */
export async function crawl(seedUrl: string, options: CrawlerOptions = {}): Promise<CrawlResult> {
  const opts = validateCrawlerOptions(seedUrl, options);
  const seed = normalizeUrl(seedUrl);
  const fetcherOpts: FetcherOptions = {
    userAgent: options.fetcher?.userAgent ?? DEFAULT_USER_AGENT,
    allowPrivateAddresses: opts.allowPrivateAddresses,
    signal: opts.signal,
    ...options.fetcher,
  };
  const userAgent = fetcherOpts.userAgent ?? DEFAULT_USER_AGENT;

  const visited = new Set<string>();
  const pages: CrawledPage[] = [];
  const queue: QueueItem[] = [{ url: seed, depth: 0 }];
  let visitedCount = 0;
  let skipped = 0;
  let attempted = 0; // number of requests actually started (for diagnostics)
  const start = Date.now();
  const gate = new RateGate(opts.delayMs, opts.signal);

  return new Promise<CrawlResult>((resolve) => {
    let resolved = false;
    let running = 0;

    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      resolve({
        seed,
        pages,
        visited: visitedCount,
        skipped,
        attempted,
        durationMs: Date.now() - start,
      });
    };

    const onAbort = (): void => {
      if (resolved) return;
      if (running === 0) {
        finish();
      }
      // If workers are running, they will observe the signal and exit; finish()
      // is called from their finally block when running reaches 0.
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const schedule = (): void => {
      if (resolved) return;
      if (opts.signal?.aborted && running === 0) {
        finish();
        return;
      }
      // Launch as many workers as concurrency allows, while there is work and
      // we have not yet hit the page budget.
      while (
        running < opts.concurrency &&
        queue.length > 0 &&
        visitedCount + running < opts.maxPages &&
        !opts.signal?.aborted
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
        void processItem(item)
          .catch((err) => {
            // Should not happen — processItem catches internally — but guard
            // against unhandled rejections so the process never dies silently.
            pages.push({
              url: item.url,
              depth: item.depth,
              status: 0,
              metadata: null,
              error: `unexpected worker error: ${(err as Error).message}`,
            });
            skipped++;
          })
          .finally(() => {
            running--;
            if (running === 0) {
              if (queue.length === 0 || visitedCount >= opts.maxPages || opts.signal?.aborted) {
                finish();
              } else {
                schedule();
              }
            } else if (queue.length > 0 && visitedCount < opts.maxPages && !opts.signal?.aborted) {
              schedule();
            }
          });
      }
      if (
        running === 0 &&
        (queue.length === 0 || visitedCount >= opts.maxPages || opts.signal?.aborted)
      ) {
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
      if (opts.respectRobots) {
        try {
          const robots = await loadRobots(item.url, fetcherOpts, { userAgent });
          if (opts.signal?.aborted) return;
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

      // Enforce polite spacing between request starts (across all workers).
      try {
        await gate.acquire();
      } catch {
        // Aborted while waiting.
        return;
      }
      if (opts.signal?.aborted || visitedCount >= opts.maxPages) return;
      attempted++;

      try {
        const { value: doc } = await fetchPage(item.url, fetcherOpts, options.retry ?? {});
        if (opts.signal?.aborted) return;
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
        if (opts.signal?.aborted) return;
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
