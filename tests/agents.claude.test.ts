import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeClaudeProject, migrateClaude } from '../src/agents/claude.ts';

const FROM = '/work/comGithub/old/repo';
const TO = '/work/comGithub/new/repo';

describe('migrateClaude', () => {
  let home: string;
  let projects: string;

  async function project(name: string, cwd?: string, file = 's.jsonl') {
    const folder = join(projects, name);
    await mkdir(folder, { recursive: true });
    if (cwd) {
      await writeFile(
        join(folder, file),
        `${JSON.stringify({ type: 'summary' })}\n${JSON.stringify({ cwd })}\n`
      );
    }
    return folder;
  }

  const options = () => ({ dryRun: false, home, env: {} });

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'forgemap-claude-'));
    projects = join(home, '.claude', 'projects');
    await mkdir(projects, { recursive: true });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('encodes a path the way Claude Code names project folders', () => {
    expect(encodeClaudeProject('/root/a.b/c_d')).toBe('-root-a-b-c-d');
  });

  it('renames the project folder and folders below it, not siblings', async () => {
    await project(encodeClaudeProject(FROM), FROM);
    await project(
      encodeClaudeProject(`${FROM}/.claude/worktrees/x`),
      `${FROM}/.claude/worktrees/x`
    );
    const sibling = await project(
      encodeClaudeProject(`${FROM}-web`),
      `${FROM}-web`
    );

    const result = await migrateClaude(FROM, TO, options());

    expect(existsSync(join(projects, encodeClaudeProject(TO)))).toBe(true);
    expect(
      existsSync(
        join(projects, encodeClaudeProject(`${TO}/.claude/worktrees/x`))
      )
    ).toBe(true);
    expect(existsSync(sibling)).toBe(true);
    expect(result.changes).toHaveLength(2);
  });

  it('claims the exact folder even without a transcript, but no unverifiable child', async () => {
    await project(encodeClaudeProject(FROM));
    const child = await project(`${encodeClaudeProject(FROM)}-sub`);

    await migrateClaude(FROM, TO, options());

    expect(existsSync(join(projects, encodeClaudeProject(TO)))).toBe(true);
    expect(existsSync(child)).toBe(true);
  });

  it('skips a colliding encoding whose sessions belong elsewhere', async () => {
    // `/work/comGithub/old_repo` encodes exactly like FROM.
    const other = await project(
      encodeClaudeProject(FROM),
      '/work/comGithub/old_repo'
    );
    await migrateClaude(FROM, TO, options());
    expect(existsSync(other)).toBe(true);
  });

  it('merges into an existing target, leaving conflicts in place', async () => {
    const src = await project(encodeClaudeProject(FROM), FROM, 'a.jsonl');
    await writeFile(join(src, 'both.jsonl'), '{}\n');
    const dst = await project(encodeClaudeProject(TO), TO, 'b.jsonl');
    await writeFile(join(dst, 'both.jsonl'), '{}\n');

    const result = await migrateClaude(FROM, TO, options());

    expect(existsSync(join(dst, 'a.jsonl'))).toBe(true);
    expect(existsSync(join(src, 'both.jsonl'))).toBe(true);
    expect(existsSync(join(src, 'a.jsonl'))).toBe(false);
    expect(result.warnings[0]).toContain('left');
  });

  it('removes the emptied source after a clean merge', async () => {
    const src = await project(encodeClaudeProject(FROM), FROM, 'a.jsonl');
    await project(encodeClaudeProject(TO), TO, 'b.jsonl');
    await migrateClaude(FROM, TO, options());
    expect(existsSync(src)).toBe(false);
  });

  it('refuses paths Claude would hash', async () => {
    const long = `/${'x'.repeat(210)}`;
    const result = await migrateClaude(FROM, long, options());
    expect(result.warnings[0]).toContain('too long');
  });

  it('leaves a child folder whose new name would be too long', async () => {
    const to = `/${'y'.repeat(190)}`;
    await project(
      encodeClaudeProject(`${FROM}/deep/child`),
      `${FROM}/deep/child`
    );
    const result = await migrateClaude(FROM, to, options());
    expect(result.warnings[0]).toContain('new name too long');
  });

  it('rewrites project keys and repo paths in .claude.json', async () => {
    const file = join(home, '.claude.json');
    await writeFile(
      file,
      `${JSON.stringify(
        {
          projects: {
            '/a': { x: 1 },
            [FROM]: { trusted: true },
            [`${FROM}/sub`]: { y: 2 },
            [`${FROM}-web`]: {}
          },
          githubRepoPaths: {
            'old/repo': [FROM, `${FROM}-web`],
            'new/repo': [FROM, TO],
            other: ['/a'],
            broken: 'x'
          }
        },
        null,
        2
      )}\n`
    );

    const result = await migrateClaude(FROM, TO, options());
    const text = await readFile(file, 'utf8');
    const state = JSON.parse(text);

    expect(Object.keys(state.projects)).toEqual([
      '/a',
      TO,
      `${TO}/sub`,
      `${FROM}-web`
    ]);
    expect(state.projects[TO]).toEqual({ trusted: true });
    expect(state.githubRepoPaths['old/repo']).toEqual([TO, `${FROM}-web`]);
    expect(state.githubRepoPaths['new/repo']).toEqual([TO]);
    expect(state.githubRepoPaths.other).toEqual(['/a']);
    expect(text.endsWith('}\n')).toBe(true);
    expect(result.changes).toContain(`projects["${FROM}"] → "${TO}"`);
  });

  it('keeps a project key whose target is already taken', async () => {
    const file = join(home, '.claude.json');
    await writeFile(
      file,
      JSON.stringify({ projects: { [FROM]: { a: 1 }, [TO]: { b: 2 } } })
    );
    const result = await migrateClaude(FROM, TO, options());
    const state = JSON.parse(await readFile(file, 'utf8'));
    expect(state.projects[FROM]).toEqual({ a: 1 });
    expect(result.warnings[0]).toContain('exists too');
  });

  it('warns on an unparseable state file and leaves it be', async () => {
    const file = join(home, '.claude.json');
    await writeFile(file, '{nope');
    const result = await migrateClaude(FROM, TO, options());
    expect(await readFile(file, 'utf8')).toBe('{nope');
    expect(result.warnings[0]).toContain('could not parse');
  });

  it('changes nothing on a dry run', async () => {
    const folder = await project(encodeClaudeProject(FROM), FROM);
    const file = join(home, '.claude.json');
    const before = JSON.stringify({ projects: { [FROM]: {} } });
    await writeFile(file, before);

    const result = await migrateClaude(FROM, TO, {
      ...options(),
      dryRun: true
    });

    expect(existsSync(folder)).toBe(true);
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(result.changes).toHaveLength(2);
  });

  it('honours CLAUDE_CONFIG_DIR for both folder and state file', async () => {
    const custom = join(home, 'custom');
    await mkdir(join(custom, 'projects', encodeClaudeProject(FROM)), {
      recursive: true
    });
    await writeFile(
      join(custom, '.claude.json'),
      JSON.stringify({ projects: { [FROM]: {} } })
    );

    await migrateClaude(FROM, TO, {
      ...options(),
      env: { CLAUDE_CONFIG_DIR: custom }
    });

    expect(existsSync(join(custom, 'projects', encodeClaudeProject(TO)))).toBe(
      true
    );
    const state = JSON.parse(
      await readFile(join(custom, '.claude.json'), 'utf8')
    );
    expect(Object.keys(state.projects)).toEqual([TO]);
  });

  it('does nothing when Claude Code was never used', async () => {
    await rm(join(home, '.claude'), { recursive: true });
    const result = await migrateClaude(FROM, TO, options());
    expect(result).toEqual({ tool: 'claude', changes: [], warnings: [] });
  });
});
