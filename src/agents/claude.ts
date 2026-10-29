import { existsSync } from 'node:fs';
import { readdir, readFile, rename, rmdir } from 'node:fs/promises';
import { join } from 'pathe';
import { readFirstJsonLine } from './jsonl.ts';
import {
  type AgentMigration,
  type MigrateOptions,
  relocatePath,
  writeAtomic
} from './shared.ts';

/**
 * Claude Code keys a project's session folder by its absolute path with every
 * non-alphanumeric character turned into `-`. The mapping is lossy (`a/b-c`
 * and `a/b/c` collide), which is why sessions are checked by their recorded
 * `cwd` before a folder is claimed.
 */
export function encodeClaudeProject(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Beyond this, Claude Code truncates the name and appends a hash we can't reproduce. */
const MAX_ENCODED_LENGTH = 200;

async function sessionCwd(dir: string): Promise<string | null> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return null;
  }
  for (const file of files) {
    const line = await readFirstJsonLine(
      join(dir, file),
      (entry) => typeof entry.cwd === 'string'
    );
    if (line) return line.cwd as string;
  }
  return null;
}

/** Rename `src` to `dst`, merging entry by entry when `dst` already exists. */
async function moveDir(
  src: string,
  dst: string,
  warnings: string[]
): Promise<void> {
  if (!existsSync(dst)) {
    await rename(src, dst);
    return;
  }
  for (const entry of await readdir(src)) {
    if (existsSync(join(dst, entry))) {
      warnings.push(`left ${join(src, entry)} in place: ${dst} has one too`);
      continue;
    }
    await rename(join(src, entry), join(dst, entry));
  }
  try {
    await rmdir(src);
  } catch {
    // Something stayed behind on a conflict — already warned about.
  }
}

async function migrateProjectDirs(
  projectsDir: string,
  from: string,
  to: string,
  options: MigrateOptions,
  result: AgentMigration
): Promise<void> {
  const encFrom = encodeClaudeProject(from);
  const encTo = encodeClaudeProject(to);
  if (
    encFrom.length > MAX_ENCODED_LENGTH ||
    encTo.length > MAX_ENCODED_LENGTH
  ) {
    result.warnings.push(
      'path too long for a plain Claude project folder name — session folders left in place'
    );
    return;
  }

  let names: string[];
  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return; // no projects folder — nothing recorded
  }

  for (const name of names.sort()) {
    if (name !== encFrom && !name.startsWith(`${encFrom}-`)) continue;
    const cwd = await sessionCwd(join(projectsDir, name));
    // A folder below `from` (a worktree, a subdirectory) shares the encoded
    // prefix with a sibling such as `from-web`; only its sessions' cwd can
    // tell the two apart, so an unverifiable one is left alone.
    const belongs = cwd
      ? relocatePath(cwd, from, to) !== null
      : name === encFrom;
    if (!belongs) continue;

    const target = encTo + name.slice(encFrom.length);
    if (target.length > MAX_ENCODED_LENGTH) {
      result.warnings.push(`left projects/${name} in place: new name too long`);
      continue;
    }
    result.changes.push(`projects/${name} → projects/${target}`);
    if (!options.dryRun) {
      await moveDir(
        join(projectsDir, name),
        join(projectsDir, target),
        result.warnings
      );
    }
  }
}

function relocateKeys(
  record: Record<string, unknown>,
  from: string,
  to: string,
  label: string,
  result: AgentMigration
): Record<string, unknown> | null {
  let changed = false;
  const next: Record<string, unknown> = {};
  // Rebuilt in order rather than delete-and-add, so the file's diff stays a
  // rename of the key instead of a move to the end.
  for (const [key, value] of Object.entries(record)) {
    const moved = relocatePath(key, from, to);
    if (moved === null) {
      next[key] = value;
    } else if (moved in record) {
      result.warnings.push(`kept ${label}["${key}"]: "${moved}" exists too`);
      next[key] = value;
    } else {
      next[moved] = value;
      changed = true;
      result.changes.push(`${label}["${key}"] → "${moved}"`);
    }
  }
  return changed ? next : null;
}

function relocateRepoPaths(
  record: Record<string, unknown>,
  from: string,
  to: string,
  result: AgentMigration
): boolean {
  let changed = false;
  for (const [key, value] of Object.entries(record)) {
    if (!Array.isArray(value)) continue;
    const paths = value.map((p) =>
      typeof p === 'string' ? (relocatePath(p, from, to) ?? p) : p
    );
    if (paths.every((p, i) => p === value[i])) continue;
    record[key] = [...new Set(paths)];
    changed = true;
    result.changes.push(`githubRepoPaths["${key}"]`);
  }
  return changed;
}

async function migrateStateFile(
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
  let state: Record<string, unknown>;
  try {
    state = JSON.parse(text) as Record<string, unknown>;
  } catch {
    result.warnings.push(`could not parse ${file} — left untouched`);
    return;
  }

  let changed = false;
  if (state.projects && typeof state.projects === 'object') {
    const projects = relocateKeys(
      state.projects as Record<string, unknown>,
      from,
      to,
      'projects',
      result
    );
    if (projects) {
      state.projects = projects;
      changed = true;
    }
  }
  if (state.githubRepoPaths && typeof state.githubRepoPaths === 'object') {
    changed =
      relocateRepoPaths(
        state.githubRepoPaths as Record<string, unknown>,
        from,
        to,
        result
      ) || changed;
  }

  if (changed && !options.dryRun) {
    const newline = text.endsWith('\n') ? '\n' : '';
    await writeAtomic(file, `${JSON.stringify(state, null, 2)}${newline}`);
  }
}

/**
 * Carry Claude Code's per-project state from `from` to `to`: the session
 * folders `/resume` lists, and the project entry (trust, allowed tools, MCP
 * servers) in `.claude.json`. Session transcripts are not rewritten — they
 * are history, and resuming does not depend on the paths inside them.
 */
export async function migrateClaude(
  from: string,
  to: string,
  options: MigrateOptions
): Promise<AgentMigration> {
  const result: AgentMigration = { tool: 'claude', changes: [], warnings: [] };
  const custom = options.env.CLAUDE_CONFIG_DIR;
  const configDir = custom || join(options.home, '.claude');
  const stateFile = custom
    ? join(custom, '.claude.json')
    : join(options.home, '.claude.json');

  await migrateProjectDirs(
    join(configDir, 'projects'),
    from,
    to,
    options,
    result
  );
  await migrateStateFile(stateFile, from, to, options, result);
  return result;
}
