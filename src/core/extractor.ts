/**
 * HTML extractor built on Cheerio.
 *
 * Provides structured metadata extraction (title, description, canonical,
 * headings, internal links) and arbitrary CSS-selector extraction.
 */
import * as cheerio from 'cheerio';
import type { ExtractedItem, ExtractionResult, PageMetadata } from '../types/index.js';
import { isSameOrigin, resolveUrl, normalizeUrl } from './url.js';

/**
 * Load an HTML string into a Cheerio instance.
 */
export function loadHtml(html: string): cheerio.CheerioAPI {
  return cheerio.load(html);
}

/**
 * Extract structured metadata from an HTML document.
 */
export function extractMetadata(
  html: string,
  sourceUrl: string,
  options: { includeHtml?: boolean; finalUrl?: string; status?: number } = {},
): PageMetadata {
  const $ = loadHtml(html);
  const title = $('title').first().text().trim() || null;
  const description = $('meta[name="description"]').attr('content')?.trim() || null;
  const canonicalRaw = $('link[rel="canonical"]').attr('href')?.trim() || null;
  let canonical: string | null = null;
  if (canonicalRaw) {
    try {
      canonical = normalizeUrl(canonicalRaw, sourceUrl);
    } catch {
      canonical = canonicalRaw;
    }
  }

  const headings: Record<string, string[]> = {};
  for (let level = 1; level <= 6; level++) {
    const tag = `h${level}`;
    const texts: string[] = [];
    $(tag).each((_, el) => {
      const text = $(el).text().trim();
      if (text) texts.push(text);
    });
    if (texts.length > 0) headings[tag] = texts;
  }

  const internalLinks = extractInternalLinks($, sourceUrl);

  const meta: PageMetadata = {
    url: sourceUrl,
    status: options.status ?? 200,
    title,
    description,
    canonical,
    headings,
    internalLinks,
  };
  if (options.finalUrl && options.finalUrl !== sourceUrl) {
    meta.finalUrl = options.finalUrl;
  }
  if (options.includeHtml) {
    meta.html = html;
  }
  return meta;
}

/**
 * Discover same-origin absolute links on a page.
 */
export function extractInternalLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    // Skip fragment-only and javascript: links early.
    if (href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) return;
    const resolved = resolveUrl(href, baseUrl);
    if (!resolved) return;
    if (!isSameOrigin(resolved, baseUrl)) return;
    if (seen.has(resolved)) return;
    seen.add(resolved);
    result.push(resolved);
  });
  return result;
}

/**
 * Extract items matching a CSS selector.
 *
 * If `attribute` is provided, the attribute value is extracted; otherwise the
 * trimmed text content is extracted. Missing elements produce an empty array
 * rather than throwing.
 */
export function extractSelector(
  html: string,
  selector: string,
  attribute?: string,
): ExtractedItem[] {
  if (!selector || typeof selector !== 'string') {
    return [];
  }
  const $ = loadHtml(html);
  const items: ExtractedItem[] = [];
  $(selector).each((index, el) => {
    const $el = $(el);
    if (attribute) {
      const value = $el.attr(attribute);
      if (value !== undefined) {
        items.push({ attr: value, index });
      } else {
        // Element matched but attribute is absent — still record an empty item
        // so the caller can see the match and the missing attribute.
        items.push({ attr: '', index });
      }
    } else {
      const text = $el.text().trim();
      items.push({ text, index });
    }
  });
  return items;
}

/**
 * Build a full ExtractionResult for a fetched document.
 */
export function buildExtractionResult(
  url: string,
  selector: string,
  items: ExtractedItem[],
  attribute?: string,
): ExtractionResult {
  const result: ExtractionResult = { url, selector, items };
  if (attribute) result.attribute = attribute;
  return result;
}
