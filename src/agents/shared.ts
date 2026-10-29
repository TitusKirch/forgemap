import { rename, writeFile } from 'node:fs/promises';

/** What one tool's migration did — or, on a dry run, would do. */
export interface AgentMigration {
  tool: 'claude' | 'codex';
  changes: string[];
  warnings: string[];
}

export interface MigrateOptions {
  dryRun: boolean;
  home: string;
  env: NodeJS.ProcessEnv;
}

/**
 * `path` relocated from under `from` to under `to`, or null when it is not
 * `from` itself or below it. A plain prefix test would also catch the sibling
 * `from-web`, so the boundary must be a `/`.
 */
export function relocatePath(
  path: string,
  from: string,
  to: string
): string | null {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  return null;
}

/**
 * Relocate every string in a JSON value that is a path at or below `from`.
 * Strings that merely *mention* the path — prose, a command line — are left
 * alone: rewriting history text is not what makes a session resumable.
 */
export function relocateDeep(
  value: unknown,
  from: string,
  to: string
): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    const next = relocatePath(value, from, to);
    return next === null
      ? { value, changed: false }
      : { value: next, changed: true };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const r = relocateDeep(item, from, to);
      changed ||= r.changed;
      return r.value;
    });
    return { value: changed ? next : value, changed };
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const r = relocateDeep(item, from, to);
      changed ||= r.changed;
      next[key] = r.value;
    }
    return { value: changed ? next : value, changed };
  }
  return { value, changed: false };
}

/** Write via a sibling temp file and rename, so a reader never sees a torn file. */
export async function writeAtomic(
  path: string,
  content: string
): Promise<void> {
  const tmp = `${path}.forgemap-${process.pid}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}
