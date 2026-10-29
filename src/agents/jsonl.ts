import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm, stat, utimes } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

type Entry = Record<string, unknown>;

function parse(line: string): Entry | null {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Entry)
      : null;
  } catch {
    return null;
  }
}

/**
 * The first entry among a JSONL file's leading `maxLines` lines that matches,
 * streamed so a multi-gigabyte transcript is never read whole.
 */
export async function readFirstJsonLine(
  file: string,
  match: (entry: Entry) => boolean,
  maxLines = 50
): Promise<Entry | null> {
  const stream = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let seen = 0;
  try {
    for await (const line of lines) {
      const entry = parse(line);
      if (entry && match(entry)) return entry;
      if (++seen >= maxLines) break;
    }
  } catch {
    // Unreadable file — treat as no match.
  } finally {
    lines.close();
    stream.destroy();
  }
  return null;
}

/**
 * Stream a JSONL file through `transform`, which returns a replacement entry
 * or null to keep the line byte-for-byte. Only lines containing `needle` are
 * parsed at all. The file is replaced atomically and keeps its timestamps,
 * since tools that list sessions sort by them. Returns whether anything
 * changed; an unchanged file is never rewritten.
 */
export async function rewriteJsonl(
  file: string,
  needle: string,
  transform: (entry: Entry) => Entry | null
): Promise<boolean> {
  const tmp = `${file}.forgemap-${process.pid}.tmp`;
  const input = createReadStream(file, { encoding: 'utf8' });
  const output = createWriteStream(tmp, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let changed = false;
  let first = true;
  try {
    for await (const line of lines) {
      let out = line;
      if (line.includes(needle)) {
        const entry = parse(line);
        const next = entry && transform(entry);
        if (next) {
          out = JSON.stringify(next);
          changed = true;
        }
      }
      if (!output.write(`${first ? '' : '\n'}${out}`)) {
        await once(output, 'drain');
      }
      first = false;
    }
    // Preserve a trailing newline: readline drops the empty last "line".
    const { size } = await stat(file);
    if (size > 0) {
      const tail = createReadStream(file, { start: size - 1 });
      const [last] = (await tail.toArray()) as Buffer[];
      if (last?.toString() === '\n') output.write('\n');
    }
    output.end();
    await once(output, 'finish');
  } catch (error) {
    output.destroy();
    await rm(tmp, { force: true });
    throw error;
  }

  if (!changed) {
    await rm(tmp, { force: true });
    return false;
  }
  const { atime, mtime } = await stat(file);
  await rename(tmp, file);
  await utimes(file, atime, mtime);
  return true;
}
