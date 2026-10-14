import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  loadHtml,
  extractMetadata,
  extractSelector,
  extractInternalLinks,
  buildExtractionResult,
} from '../../src/core/extractor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const exampleHtml = readFileSync(join(__dirname, '..', 'fixtures', 'example.html'), 'utf8');

describe('extractor', () => {
  describe('extractSelector — text', () => {
    it('selects h1 elements and returns trimmed text', () => {
      const items = extractSelector(exampleHtml, 'h1');
      expect(items.length).toBe(2);
      expect(items[0]?.text).toBe('Welcome to the Example Page');
      expect(items[1]?.text).toBe('Article Title');
    });
    it('preserves index ordering', () => {
      const items = extractSelector(exampleHtml, 'h2');
      expect(items.map((i) => i.index)).toEqual([0, 1]);
      expect(items.map((i) => i.text)).toEqual(['Section One', 'Section Two']);
    });
  });

  describe('extractSelector — attribute', () => {
    it('extracts href attributes from anchors', () => {
      const items = extractSelector(exampleHtml, 'a', 'href');
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => typeof i.attr === 'string')).toBe(true);
    });
    it('extracts content from meta tags', () => {
      const items = extractSelector(exampleHtml, 'meta[name="description"]', 'content');
      expect(items.length).toBe(1);
      expect(items[0]?.attr).toBe('A small example page used by ScrapeKit tests.');
    });
    it('records empty attr value when attribute is absent on a matched element', () => {
      const html = '<div class="x"></div><div class="x" data-id="1"></div>';
      const items = extractSelector(html, '.x', 'data-id');
      expect(items.length).toBe(2);
      expect(items[0]?.attr).toBe('');
      expect(items[1]?.attr).toBe('1');
    });
  });

  describe('extractSelector — missing selector / no matches', () => {
    it('returns empty array when nothing matches', () => {
      expect(extractSelector(exampleHtml, '.does-not-exist')).toEqual([]);
    });
    it('returns empty array for empty selector', () => {
      expect(extractSelector(exampleHtml, '')).toEqual([]);
    });
  });

  describe('extractMetadata', () => {
    const meta = extractMetadata(exampleHtml, 'https://example.com/', { status: 200 });
    it('extracts the title', () => {
      expect(meta.title).toBe('Example — ScrapeKit Fixture');
    });
    it('extracts the meta description', () => {
      expect(meta.description).toBe('A small example page used by ScrapeKit tests.');
    });
    it('extracts the canonical URL', () => {
      expect(meta.canonical).toBe('http://example.com/');
    });
    it('groups headings by level', () => {
      expect(meta.headings['h1']).toEqual(['Welcome to the Example Page', 'Article Title']);
      expect(meta.headings['h2']).toEqual(['Section One', 'Section Two']);
    });
    it('includes same-origin internal links only', () => {
      expect(meta.internalLinks).toContain('https://example.com/about');
      expect(meta.internalLinks).toContain('https://example.com/contact');
      // External link excluded.
      expect(meta.internalLinks).not.toContain('https://other.com/external');
    });
    it('deduplicates internal links', () => {
      const unique = new Set(meta.internalLinks);
      expect(unique.size).toBe(meta.internalLinks.length);
    });
    it('includes html when requested', () => {
      const m = extractMetadata(exampleHtml, 'https://example.com/', { includeHtml: true });
      expect(m.html).toBe(exampleHtml);
    });
  });

  describe('extractInternalLinks', () => {
    it('skips javascript: and fragment-only links', () => {
      const $ = loadHtml(exampleHtml);
      const links = extractInternalLinks($, 'https://example.com/');
      expect(links.every((l) => !l.startsWith('javascript:'))).toBe(true);
      expect(links.every((l) => !l.startsWith('#'))).toBe(true);
    });
  });

  describe('buildExtractionResult', () => {
    it('builds a typed result with attribute', () => {
      const r = buildExtractionResult(
        'https://example.com',
        'a',
        [{ attr: '/x', index: 0 }],
        'href',
      );
      expect(r).toEqual({
        url: 'https://example.com',
        selector: 'a',
        attribute: 'href',
        items: [{ attr: '/x', index: 0 }],
      });
    });
    it('omits attribute when not provided', () => {
      const r = buildExtractionResult('https://example.com', 'h1', [{ text: 'Hi', index: 0 }]);
      expect('attribute' in r).toBe(false);
    });
  });

  describe('missing elements do not crash', () => {
    it('returns null fields for an empty document', () => {
      const meta = extractMetadata('<html></html>', 'https://example.com/');
      expect(meta.title).toBeNull();
      expect(meta.description).toBeNull();
      expect(meta.canonical).toBeNull();
      expect(meta.internalLinks).toEqual([]);
    });
  });
});
