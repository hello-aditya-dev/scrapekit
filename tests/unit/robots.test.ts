import { describe, it, expect, vi, beforeEach } from 'vitest';
import robotsParserModule from 'robots-parser';
import {
  isAllowed,
  robotsUrlFor,
  clearRobotsCache,
  type RobotsResult,
} from '../../src/core/robots.js';

// The bundled robots-parser type definitions are ambiguous; coerce to a
// concrete function for test construction.
const robotsParser = robotsParserModule as unknown as (url: string, body: string) => RobotsResult;

describe('robots', () => {
  beforeEach(() => {
    clearRobotsCache();
  });

  describe('robotsUrlFor', () => {
    it('builds the /robots.txt URL for an origin', () => {
      expect(robotsUrlFor('https://example.com/page')).toBe('https://example.com/robots.txt');
      expect(robotsUrlFor('http://example.com:8080/a/b')).toBe(
        'http://example.com:8080/robots.txt',
      );
    });
  });

  describe('isAllowed', () => {
    it('returns true for an explicitly allowed path', () => {
      const robots = robotsParser('https://example.com/robots.txt', 'User-agent: *\nAllow: /\n');
      expect(isAllowed(robots, 'https://example.com/anything', 'ScrapeKit')).toBe(true);
    });

    it('returns false for a disallowed path', () => {
      const robots = robotsParser(
        'https://example.com/robots.txt',
        'User-agent: *\nDisallow: /private\n',
      );
      expect(isAllowed(robots, 'https://example.com/private/secret', 'ScrapeKit')).toBe(false);
      expect(isAllowed(robots, 'https://example.com/public', 'ScrapeKit')).toBe(true);
    });

    it('respects user-agent-specific rules', () => {
      const robots = robotsParser(
        'https://example.com/robots.txt',
        'User-agent: BadBot\nDisallow: /\nUser-agent: *\nAllow: /\n',
      );
      expect(isAllowed(robots, 'https://example.com/', 'BadBot')).toBe(false);
      expect(isAllowed(robots, 'https://example.com/', 'ScrapeKit')).toBe(true);
    });

    it('treats disallowed root as blocking everything', () => {
      const robots = robotsParser('https://example.com/robots.txt', 'User-agent: *\nDisallow: /\n');
      expect(isAllowed(robots, 'https://example.com/', 'ScrapeKit')).toBe(false);
      expect(isAllowed(robots, 'https://example.com/page', 'ScrapeKit')).toBe(false);
    });
  });

  describe('cache', () => {
    it('clearRobotsCache does not throw', () => {
      expect(() => clearRobotsCache()).not.toThrow();
    });
  });
});

// Silence unused-import lint for vi in some setups.
void vi;
