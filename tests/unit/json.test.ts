import { describe, it, expect } from 'vitest';
import { toJson } from '../../src/exporters/json.js';

describe('json exporter', () => {
  it('serializes objects with 2-space indentation', () => {
    const out = toJson({ a: 1, b: ['x', 'y'] });
    expect(out).toContain('\n  "a": 1');
    expect(out.endsWith('\n')).toBe(true);
  });
  it('serializes arrays', () => {
    const out = toJson([1, 2, 3]);
    expect(JSON.parse(out)).toEqual([1, 2, 3]);
  });
  it('supports compact mode', () => {
    const out = toJson({ a: 1 }, false);
    expect(out).toBe('{"a":1}\n');
  });
  it('handles empty results safely', () => {
    expect(toJson([])).toBe('[]\n');
    expect(toJson({})).toBe('{}\n');
  });
  it('handles nested complex values', () => {
    const out = toJson({ items: [{ text: 'a,b', attr: 'href' }] });
    expect(JSON.parse(out).items[0].attr).toBe('href');
  });
});
