import { describe, it, expect } from 'vitest';
import {
  validateCrawlerOptions,
  validateFetcherOptions,
  validateRetryOptions,
} from '../../src/core/config.js';
import { ScrapeKitError } from '../../src/types/index.js';

describe('config validation', () => {
  describe('validateCrawlerOptions', () => {
    it('applies defaults when no options provided', () => {
      const v = validateCrawlerOptions('https://example.com/');
      expect(v.maxPages).toBe(10);
      expect(v.maxDepth).toBe(2);
      expect(v.delayMs).toBe(1000);
      expect(v.concurrency).toBe(2);
      expect(v.respectRobots).toBe(true);
      expect(v.allowPrivateAddresses).toBe(false);
    });
    it('rejects concurrency 0', () => {
      expect(() => validateCrawlerOptions('https://example.com/', { concurrency: 0 })).toThrow(
        ScrapeKitError,
      );
      expect(() => validateCrawlerOptions('https://example.com/', { concurrency: 0 })).toThrow(
        /concurrency must be >= 1/,
      );
    });
    it('rejects negative concurrency', () => {
      expect(() => validateCrawlerOptions('https://example.com/', { concurrency: -1 })).toThrow(
        ScrapeKitError,
      );
    });
    it('rejects non-integer concurrency', () => {
      expect(() => validateCrawlerOptions('https://example.com/', { concurrency: 1.5 })).toThrow(
        ScrapeKitError,
      );
    });
    it('rejects maxPages 0', () => {
      expect(() => validateCrawlerOptions('https://example.com/', { maxPages: 0 })).toThrow(
        ScrapeKitError,
      );
    });
    it('rejects negative delayMs', () => {
      expect(() => validateCrawlerOptions('https://example.com/', { delayMs: -1 })).toThrow(
        ScrapeKitError,
      );
    });
    it('rejects non-integer maxDepth', () => {
      expect(() => validateCrawlerOptions('https://example.com/', { maxDepth: 2.5 })).toThrow(
        ScrapeKitError,
      );
    });
    it('rejects absurdly large values', () => {
      expect(() => validateCrawlerOptions('https://example.com/', { maxPages: 999_999 })).toThrow(
        ScrapeKitError,
      );
      expect(() => validateCrawlerOptions('https://example.com/', { concurrency: 999 })).toThrow(
        ScrapeKitError,
      );
    });
    it('rejects empty seed URL', () => {
      expect(() => validateCrawlerOptions('')).toThrow(ScrapeKitError);
      expect(() => validateCrawlerOptions('   ')).toThrow(ScrapeKitError);
    });
    it('accepts valid edge-case values', () => {
      const v = validateCrawlerOptions('https://example.com/', {
        maxPages: 1,
        maxDepth: 0,
        delayMs: 0,
        concurrency: 1,
      });
      expect(v.maxPages).toBe(1);
      expect(v.maxDepth).toBe(0);
      expect(v.delayMs).toBe(0);
      expect(v.concurrency).toBe(1);
    });
  });

  describe('validateFetcherOptions', () => {
    it('applies defaults', () => {
      const v = validateFetcherOptions();
      expect(v.timeoutMs).toBe(15000);
      expect(v.maxRedirects).toBe(5);
      expect(v.allowPrivateAddresses).toBe(false);
    });
    it('rejects timeout 0', () => {
      expect(() => validateFetcherOptions({ timeoutMs: 0 })).toThrow(ScrapeKitError);
    });
    it('rejects negative maxRedirects', () => {
      expect(() => validateFetcherOptions({ maxRedirects: -1 })).toThrow(ScrapeKitError);
    });
    it('rejects empty userAgent', () => {
      expect(() => validateFetcherOptions({ userAgent: '' })).toThrow(ScrapeKitError);
      expect(() => validateFetcherOptions({ userAgent: '   ' })).toThrow(ScrapeKitError);
    });
    it('accepts maxBodyBytes', () => {
      const v = validateFetcherOptions({ maxBodyBytes: 1024 });
      expect(v.maxBodyBytes).toBe(1024);
    });
  });

  describe('validateRetryOptions', () => {
    it('applies defaults', () => {
      const v = validateRetryOptions();
      expect(v.maxRetries).toBe(3);
      expect(v.baseDelayMs).toBe(500);
      expect(v.maxDelayMs).toBe(8000);
      expect(v.respectRetryAfter).toBe(true);
    });
    it('rejects negative maxRetries', () => {
      expect(() => validateRetryOptions({ maxRetries: -1 })).toThrow(ScrapeKitError);
    });
    it('rejects baseDelayMs > maxDelayMs', () => {
      expect(() => validateRetryOptions({ baseDelayMs: 1000, maxDelayMs: 500 })).toThrow(
        ScrapeKitError,
      );
    });
    it('accepts zero delays', () => {
      const v = validateRetryOptions({ baseDelayMs: 0, maxDelayMs: 0 });
      expect(v.baseDelayMs).toBe(0);
    });
  });
});
