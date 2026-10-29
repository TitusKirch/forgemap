import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'pathe';
import { mapLimit } from '../utils/concurrency.ts';
import { readFirstJsonLine, rewriteJsonl } from './jsonl.ts';
import {
  type AgentMigration,
  type MigrateOptions,
  relocateDeep,
  relocatePath,
  writeAtomic
} from './shared.ts';

type Sqlite = typeof import('node:sqlite');

let sqlite: Sqlite | undefined;

/**
 * `node:sqlite` still announces itself as experimental on Node 24. The warning
 * is noise to someone moving a repo, so it is swallowed for the import alone.
 */
async function loadSqlite(): Promise<Sqlite> {
  if (sqlite) return sqlite;
  const original = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (text.includes('SQLite')) return;
    (original as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    sqlite = await import('node:sqlite');
  } finally {
    process.emitWarning = original;
  }
  return sqlite;
}

const SESSION_DIRS = ['sessions', 'archived_sessions'];
const SCAN_CONCURRENCY = 16;
const PROJECT_HEADER = /^(\s*\[projects\.)"((?:[^"\\]|\\.)*)"(\]\s*)$/;

/** The trust entries — `[projects."<path>"]` — in `config.toml`. */
async function migrateConfigToml(
  file: string,
  from: string,
  to: string,
  options: MigrateOptions,
  result: AgentMigration
): Promise<void> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return;
  }
  const lines = text.split('\n');
  const keys = new Set(
    lines.flatMap((line) => {
      const m = PROJECT_HEADER.exec(line);
      return m ? [m[2]!] : [];
    })
  );

  let changed = false;
  const next = lines.map((line) => {
    const m = PROJECT_HEADER.exec(line);
    if (!m) return line;
    const moved = relocatePath(m[2]!, from, to);
    if (moved === null) return line;
    if (keys.has(moved)) {
      result.warnings.push(
        `kept config.toml [projects."${m[2]}"]: "${moved}" exists too`
      );
      return line;
    }
    changed = true;
    result.changes.push(`config.toml [projects."${m[2]}"] → "${moved}"`);
    return `${m[1]}"${moved}"${m[3]}`;
  });

  if (changed && !options.dryRun) await writeAtomic(file, next.join('\n'));
}

async function listRollouts(codexHome: string): Promise<string[]> {
  const files: string[] = [];
  for (const dir of SESSION_DIRS) {
    const root = join(codexHome, dir);
    let entries: string[];
    try {
      entries = await readdir(root, { recursive: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (basename(entry).startsWith('rollout-') && entry.endsWith('.jsonl')) {
        files.push(join(root, entry));
      }
    }
  }
  return files.sort();
}

/**
 * Rollout transcripts open with a `session_meta` line naming the session's
 * `cwd` — that is what `codex resume` filters by. `turn_context` lines repeat
 * it, together with the sandbox's writable roots, so both are relocated.
 */
async function migrateRollouts(
  codexHome: string,
  from: string,
  to: string,
  options: MigrateOptions,
  result: AgentMigration
): Promise<void> {
  const files = await listRollouts(codexHome);
  const owned = await mapLimit(files, SCAN_CONCURRENCY, async (file) => {
    const meta = await readFirstJsonLine(
      file,
      (entry) => entry.type === 'session_meta',
      1
    );
    const payload = meta?.payload as { cwd?: unknown } | undefined;
    return typeof payload?.cwd === 'string' &&
      relocatePath(payload.cwd, from, to) !== null
      ? file
      : null;
  });
  const matches = owned.filter((f): f is string => f !== null);
  if (matches.length === 0) return;

  result.changes.push(`${matches.length} session transcript(s)`);
  if (options.dryRun) return;

  for (const file of matches) {
    try {
      await rewriteJsonl(file, from, (entry) => {
        if (entry.type !== 'session_meta' && entry.type !== 'turn_context') {
          return null;
        }
        const r = relocateDeep(entry.payload, from, to);
        return r.changed ? { ...entry, payload: r.value } : null;
      });
    } catch (error) {
      result.warnings.push(`${file}: ${(error as Error).message}`);
    }
  }
}

async function listStateDbs(codexHome: string): Promise<string[]> {
  const dbs: string[] = [];
  for (const dir of [codexHome, join(codexHome, 'sqlite')]) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      if (/^state_\d+\.sqlite$/.test(entry)) dbs.push(join(dir, entry));
    }
  }
  return dbs;
}

interface ThreadRow {
  rid: number;
  cwd: string;
  sandbox_policy?: string | null;
}

function relocateJsonText(text: string, from: string, to: string): string {
  try {
    const r = relocateDeep(JSON.parse(text), from, to);
    return r.changed ? JSON.stringify(r.value) : text;
  } catch {
    return text;
  }
}

/**
 * The thread index Codex keeps beside the transcripts. Its schema is Codex's
 * own and versioned in the file name, so only what is actually there is
 * touched: a `threads` table with a `cwd` column, plus its sandbox policy.
 */
async function migrateStateDb(
  file: string,
  label: string,
  from: string,
  to: string,
  options: MigrateOptions,
  result: AgentMigration
): Promise<void> {
  const { DatabaseSync } = await loadSqlite();
  let db: InstanceType<Sqlite['DatabaseSync']>;
  try {
    db = new DatabaseSync(file, { readOnly: options.dryRun });
  } catch (error) {
    result.warnings.push(`${label}: ${(error as Error).message}`);
    return;
  }
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const columns = (
      db.prepare('PRAGMA table_info(threads)').all() as Array<{ name: string }>
    ).map((c) => c.name);
    if (!columns.includes('cwd')) return;
    const policy = columns.includes('sandbox_policy');

    // substr, not LIKE: `_` and `%` are ordinary characters in a path.
    const rows = db
      .prepare(
        `SELECT rowid AS rid, cwd${policy ? ', sandbox_policy' : ''} FROM threads WHERE cwd = ? OR substr(cwd, 1, ?) = ?`
      )
      .all(from, from.length + 1, `${from}/`) as unknown as ThreadRow[];
    if (rows.length === 0) return;

    result.changes.push(`${label}: ${rows.length} thread(s)`);
    if (options.dryRun) return;

    const update = db.prepare(
      policy
        ? 'UPDATE threads SET cwd = ?, sandbox_policy = ? WHERE rowid = ?'
        : 'UPDATE threads SET cwd = ? WHERE rowid = ?'
    );
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const cwd = relocatePath(row.cwd, from, to)!;
        if (policy) {
          const sandbox =
            typeof row.sandbox_policy === 'string'
              ? relocateJsonText(row.sandbox_policy, from, to)
              : (row.sandbox_policy ?? null);
          update.run(cwd, sandbox, row.rid);
        } else {
          update.run(cwd, row.rid);
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    result.warnings.push(`${label}: ${(error as Error).message}`);
  } finally {
    db.close();
  }
}

/**
 * Carry Codex's per-project state from `from` to `to`: the trust entry, the
 * `cwd` its session transcripts record, and the thread index `codex resume`
 * reads. Message history inside the transcripts is left as written.
 */
export async function migrateCodex(
  from: string,
  to: string,
  options: MigrateOptions
): Promise<AgentMigration> {
  const result: AgentMigration = { tool: 'codex', changes: [], warnings: [] };
  const codexHome = options.env.CODEX_HOME || join(options.home, '.codex');

  await migrateConfigToml(
    join(codexHome, 'config.toml'),
    from,
    to,
    options,
    result
  );
  await migrateRollouts(codexHome, from, to, options, result);
  for (const db of await listStateDbs(codexHome)) {
    await migrateStateDb(
      db,
      relative(codexHome, db),
      from,
      to,
      options,
      result
    );
  }
  return result;
}
