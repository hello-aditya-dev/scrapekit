import { describe, it, expect, vi } from 'vitest';
import { withRetry, computeBackoff, sleep } from '../../src/core/retry.js';
import { ScrapeKitError } from '../../src/types/index.js';

describe('retry', () => {
  describe('computeBackoff', () => {
    it('returns a non-negative value bounded by maxDelayMs', () => {
      for (let i = 1; i <= 5; i++) {
        const v = computeBackoff(i, 100, 1000);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1000);
      }
    });
    it('caps exponential growth at maxDelayMs', () => {
      // attempt large → baseDelay * 2^n overflows cap; must stay <= maxDelayMs.
      expect(computeBackoff(20, 100, 500)).toBeLessThanOrEqual(500);
    });
  });

  describe('sleep', () => {
    it('resolves after the specified duration', async () => {
      const start = Date.now();
      await sleep(20);
      expect(Date.now() - start).toBeGreaterThanOrEqual(15);
    });
    it('rejects when aborted', async () => {
      const controller = new AbortController();
      const p = sleep(1000, controller.signal);
      controller.abort();
      await expect(p).rejects.toThrow('Aborted');
    });
  });

  describe('withRetry', () => {
    it('returns the value on the first success', async () => {
      const op = vi.fn(async () => 'ok');
      const result = await withRetry(op, () => false);
      expect(result.value).toBe('ok');
      expect(result.attempts).toBe(1);
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('retries retriable failures and succeeds', async () => {
      let calls = 0;
      const op = vi.fn(async () => {
        calls++;
        if (calls < 3) throw new ScrapeKitError('transient', 'NETWORK_ERROR');
        return 'recovered';
      });
      const result = await withRetry(
        op,
        (err) => err instanceof ScrapeKitError && err.code === 'NETWORK_ERROR',
        {
          maxRetries: 5,
          baseDelayMs: 1,
          maxDelayMs: 5,
        },
      );
      expect(result.value).toBe('recovered');
      expect(result.attempts).toBe(3);
    });

    it('does not retry when shouldRetry returns false', async () => {
      const op = vi.fn(async () => {
        throw new ScrapeKitError('permanent', 'HTTP_ERROR', 403);
      });
      await expect(
        withRetry(op, () => false, { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 1 }),
      ).rejects.toThrow('permanent');
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('gives up after maxRetries', async () => {
      const op = vi.fn(async () => {
        throw new ScrapeKitError('always fails', 'TIMEOUT');
      });
      await expect(
        withRetry(op, () => true, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 }),
      ).rejects.toThrow('always fails');
      // 1 initial + 2 retries = 3 attempts.
      expect(op).toHaveBeenCalledTimes(3);
    });

    it('respects a server-provided Retry-After', async () => {
      let calls = 0;
      const op = vi.fn(async () => {
        calls++;
        if (calls < 2) {
          throw new ScrapeKitError('rate limited', 'HTTP_ERROR', 429);
        }
        return 'ok';
      });
      const start = Date.now();
      const result = await withRetry(
        op,
        () => true,
        { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5, respectRetryAfter: true },
        () => 30, // 30ms server delay
      );
      const elapsed = Date.now() - start;
      expect(result.value).toBe('ok');
      // The Retry-After of 30ms should be honoured (>= 25ms after scheduling).
      expect(elapsed).toBeGreaterThanOrEqual(25);
    });

    it('aborts immediately when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const op = vi.fn(async () => {
        throw new ScrapeKitError('x', 'TIMEOUT');
      });
      await expect(
        withRetry(op, () => true, { signal: controller.signal, maxRetries: 5, baseDelayMs: 1 }),
      ).rejects.toThrow();
      expect(op).toHaveBeenCalledTimes(1);
    });
  });
});
