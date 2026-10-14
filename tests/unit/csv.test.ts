import { describe, it, expect } from 'vitest';
import { toCsv, escapeCsvField, escapeCsvRow } from '../../src/exporters/csv.js';

describe('csv exporter', () => {
  describe('escapeCsvField', () => {
    it('does not quote simple values', () => {
      expect(escapeCsvField('hello')).toBe('hello');
      expect(escapeCsvField(42)).toBe('42');
      expect(escapeCsvField(true)).toBe('true');
    });
    it('quotes fields containing a comma', () => {
      expect(escapeCsvField('a,b')).toBe('"a,b"');
    });
    it('quotes fields containing a double-quote and doubles it', () => {
      expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    });
    it('quotes fields containing a newline', () => {
      expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    });
    it('quotes fields containing a carriage return', () => {
      expect(escapeCsvField('a\r\nb')).toBe('"a\r\nb"');
    });
    it('renders null/undefined as empty', () => {
      expect(escapeCsvField(null)).toBe('');
      expect(escapeCsvField(undefined)).toBe('');
    });
    it('serializes objects/arrays as stable JSON', () => {
      expect(escapeCsvField({ a: 1 })).toBe('"{""a"":1}"');
      expect(escapeCsvField([1, 2, 3])).toBe('"[1,2,3]"');
    });
  });

  describe('escapeCsvRow', () => {
    it('joins fields with commas', () => {
      expect(escapeCsvRow(['a', 'b', 'c'])).toBe('a,b,c');
    });
  });

  describe('toCsv', () => {
    it('emits a header row from the union of keys', () => {
      const csv = toCsv([
        { a: 1, b: 2 },
        { b: 3, c: 4 },
      ]);
      const lines = csv.split('\r\n');
      expect(lines[0]).toBe('a,b,c');
      expect(lines[1]).toBe('1,2,');
      expect(lines[2]).toBe(',3,4');
    });
    it('terminates rows with CRLF and ends with CRLF', () => {
      const csv = toCsv([{ a: 1 }]);
      expect(csv.endsWith('\r\n')).toBe(true);
      expect(csv.split('\r\n').filter(Boolean)).toEqual(['a', '1']);
    });
    it('handles empty input as header-only... actually empty', () => {
      const csv = toCsv([]);
      // No rows → no header.
      expect(csv).toBe('\r\n');
    });
    it('escapes complex nested values', () => {
      const value = { x: 'a,b', y: '"q"' };
      const csv = toCsv([{ data: value }]);
      const line = csv.split('\r\n')[1]!;
      // The cell must be the JSON-serialized value, wrapped in quotes with
      // internal quotes doubled (RFC 4180).
      expect(line.startsWith('"')).toBe(true);
      expect(line.endsWith('"')).toBe(true);
      const inner = line.slice(1, -1).replace(/""/g, '"');
      expect(inner).toBe(JSON.stringify(value));
    });
    it('throws on non-array input', () => {
      expect(() => toCsv({} as never)).toThrow(TypeError);
    });
  });
});
