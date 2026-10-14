/**
 * CSV exporter with RFC 4180-compliant escaping.
 *
 * - Fields containing comma, double-quote, CR, or LF are quoted.
 * - Double quotes inside a field are escaped by doubling.
 * - Rows are terminated with CRLF (RFC 4180).
 * - A header row is always emitted, derived from the union of keys across all
 *   rows (in first-seen order). Missing values become empty strings.
 * - Complex (non-primitive) values are serialized as stable JSON strings,
 *   which themselves are CSV-escaped. This makes the schema predictable and
 *   round-trippable.
 */

/** Serialize a single value for a CSV cell (before quoting). */
function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Arrays and objects → stable JSON.
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Quote and escape a single CSV field if it needs quoting. */
export function escapeCsvField(value: unknown): string {
  const raw = serializeValue(value);
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/** Escape a complete CSV row from an array of values. */
export function escapeCsvRow(values: unknown[]): string {
  return values.map(escapeCsvField).join(',');
}

/**
 * Convert an array of records to a CSV string (with header and CRLF line
 * endings).
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!Array.isArray(rows)) {
    throw new TypeError('toCsv expects an array of records.');
  }
  // Collect the union of keys in first-seen order.
  const headerKeys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row && typeof row === 'object') {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          headerKeys.push(key);
        }
      }
    }
  }
  const lines: string[] = [];
  lines.push(escapeCsvRow(headerKeys));
  for (const row of rows) {
    lines.push(escapeCsvRow(headerKeys.map((k) => (row as Record<string, unknown>)?.[k])));
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * Write records as CSV to a file path.
 * Throws on file-writing failures.
 */
export async function writeCsvFile(path: string, rows: Record<string, unknown>[]): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, toCsv(rows), 'utf8');
}
