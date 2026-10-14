/**
 * JSON exporter.
 *
 * Serializes arbitrary serializable data to a UTF-8 JSON string with stable
 * 2-space indentation and a trailing newline.
 */
export function toJson(data: unknown, pretty = true): string {
  const json = JSON.stringify(data, null, pretty ? 2 : 0);
  return json + '\n';
}

/**
 * Write data as JSON to a file path.
 * Throws on file-writing failures (e.g. permission denied, ENOENT directory).
 */
export async function writeJsonFile(path: string, data: unknown): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, toJson(data), 'utf8');
}
