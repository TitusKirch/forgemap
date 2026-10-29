import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateCodex } from '../src/agents/codex.ts';

const FROM = '/work/comGithub/old/repo';
const TO = '/work/comGithub/new/repo';

function policy(path: string): string {
  return JSON.stringify({
    entries: [
      { path: { type: 'path', path }, access: 'write' },
      { path: { type: 'special' }, access: 'read' }
    ]
  });
}

describe('migrateCodex', () => {
  let home: string;
  let codex: string;

  const options = () => ({ dryRun: false, home, env: {} });

  async function rollout(name: string, cwd: string, trailing = '\n') {
    const dir = join(codex, 'sessions', '2026', '10', '19');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `rollout-${name}.jsonl`);
    const lines = [
      { type: 'session_meta', payload: { id: name, cwd } },
      { type: 'response_item', payload: { text: `cd ${cwd}` } },
      {
        type: 'turn_context',
        payload: { cwd, sandbox: policy(cwd), roots: [cwd] }
      },
      { type: 'event_msg', payload: { path: cwd } }
    ];
    await writeFile(
      file,
      `${lines.map((l) => JSON.stringify(l)).join('\n')}\n{broken ${cwd}${trailing}`
    );
    return file;
  }

  function createDb(file: string, withPolicy = true) {
    const db = new DatabaseSync(file);
    db.exec(
      withPolicy
        ? 'CREATE TABLE threads (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, sandbox_policy TEXT)'
        : 'CREATE TABLE threads (id TEXT PRIMARY KEY, cwd TEXT NOT NULL)'
    );
    return db;
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'forgemap-codex-'));
    codex = join(home, '.codex');
    await mkdir(codex, { recursive: true });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('rewrites trust entries in config.toml', async () => {
    const file = join(codex, 'config.toml');
    await writeFile(
      file,
      [
        'model = "x"',
        `[projects."${FROM}"]`,
        'trust_level = "trusted"',
        `[projects."${FROM}-web"]`,
        `[projects."${FROM}/sub"]`,
        ''
      ].join('\n')
    );

    const result = await migrateCodex(FROM, TO, options());
    const text = await readFile(file, 'utf8');

    expect(text).toContain(`[projects."${TO}"]\ntrust_level = "trusted"`);
    expect(text).toContain(`[projects."${FROM}-web"]`);
    expect(text).toContain(`[projects."${TO}/sub"]`);
    expect(text.endsWith('\n')).toBe(true);
    expect(result.changes).toHaveLength(2);
  });

  it('keeps a trust entry whose target exists', async () => {
    const file = join(codex, 'config.toml');
    await writeFile(file, `[projects."${FROM}"]\n[projects."${TO}"]\n`);
    const result = await migrateCodex(FROM, TO, options());
    expect(await readFile(file, 'utf8')).toBe(
      `[projects."${FROM}"]\n[projects."${TO}"]\n`
    );
    expect(result.warnings[0]).toContain('exists too');
  });

  it('relocates cwd in session_meta and turn_context only, keeping mtime', async () => {
    const file = await rollout('a', FROM);
    const other = await rollout('b', `${FROM}-web`);
    const past = new Date('2026-01-01T00:00:00Z');
    await utimes(file, past, past);
    const otherBefore = await readFile(other, 'utf8');

    const result = await migrateCodex(FROM, TO, options());

    const lines = (await readFile(file, 'utf8')).split('\n');
    expect(JSON.parse(lines[0]!).payload.cwd).toBe(TO);
    expect(JSON.parse(lines[1]!).payload.text).toBe(`cd ${FROM}`);
    const turn = JSON.parse(lines[2]!).payload;
    expect(turn.cwd).toBe(TO);
    expect(turn.roots).toEqual([TO]);
    // A JSON string field is history, not a path: left verbatim.
    expect(turn.sandbox).toBe(policy(FROM));
    expect(JSON.parse(lines[3]!).payload.path).toBe(FROM);
    expect(lines[4]).toBe(`{broken ${FROM}`);
    expect(lines[5]).toBe('');
    expect((await stat(file)).mtime.getTime()).toBe(past.getTime());
    expect(await readFile(other, 'utf8')).toBe(otherBefore);
    expect(result.changes).toContain('1 session transcript(s)');
  });

  it('keeps a file without a trailing newline that way', async () => {
    const file = await rollout('c', FROM, '');
    await migrateCodex(FROM, TO, options());
    expect((await readFile(file, 'utf8')).endsWith(`{broken ${FROM}`)).toBe(
      true
    );
  });

  it('finds archived transcripts too', async () => {
    const dir = join(codex, 'archived_sessions');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'rollout-z.jsonl');
    await writeFile(
      file,
      `${JSON.stringify({ type: 'session_meta', payload: { cwd: `${FROM}/x` } })}\n`
    );
    await migrateCodex(FROM, TO, options());
    expect(JSON.parse(await readFile(file, 'utf8')).payload.cwd).toBe(
      `${TO}/x`
    );
  });

  it('updates threads in every state database', async () => {
    const db = createDb(join(codex, 'state_5.sqlite'));
    const insert = db.prepare('INSERT INTO threads VALUES (?, ?, ?)');
    insert.run('a', FROM, policy(FROM));
    insert.run('b', `${FROM}/sub`, 'not json');
    insert.run('c', `${FROM}-web`, policy(`${FROM}-web`));
    insert.run('d', '/work/comGithub/old/repo_x', null);
    db.close();
    await mkdir(join(codex, 'sqlite'));
    const old = createDb(join(codex, 'sqlite', 'state_4.sqlite'), false);
    old.prepare('INSERT INTO threads VALUES (?, ?)').run('a', FROM);
    old.close();

    const result = await migrateCodex(FROM, TO, options());

    const check = new DatabaseSync(join(codex, 'state_5.sqlite'));
    const rows = check
      .prepare('SELECT id, cwd, sandbox_policy FROM threads ORDER BY id')
      .all() as Array<{ id: string; cwd: string; sandbox_policy: string }>;
    check.close();
    expect(rows.map((r) => r.cwd)).toEqual([
      TO,
      `${TO}/sub`,
      `${FROM}-web`,
      '/work/comGithub/old/repo_x'
    ]);
    expect(JSON.parse(rows[0]!.sandbox_policy).entries[0].path.path).toBe(TO);
    expect(rows[1]!.sandbox_policy).toBe('not json');

    const checkOld = new DatabaseSync(join(codex, 'sqlite', 'state_4.sqlite'));
    expect(checkOld.prepare('SELECT cwd FROM threads').get()).toEqual({
      cwd: TO
    });
    checkOld.close();
    expect(result.changes).toEqual([
      'state_5.sqlite: 2 thread(s)',
      'sqlite/state_4.sqlite: 1 thread(s)'
    ]);
  });

  it('ignores a database without a threads.cwd column', async () => {
    const db = new DatabaseSync(join(codex, 'state_9.sqlite'));
    db.exec('CREATE TABLE other (x TEXT)');
    db.close();
    const result = await migrateCodex(FROM, TO, options());
    expect(result).toEqual({ tool: 'codex', changes: [], warnings: [] });
  });

  it('warns about a database it cannot read', async () => {
    await writeFile(join(codex, 'state_5.sqlite'), 'not a database at all');
    const result = await migrateCodex(FROM, TO, options());
    expect(result.warnings[0]).toContain('state_5.sqlite');
  });

  it('changes nothing on a dry run', async () => {
    await writeFile(join(codex, 'config.toml'), `[projects."${FROM}"]\n`);
    const file = await rollout('a', FROM);
    const before = await readFile(file, 'utf8');
    const db = createDb(join(codex, 'state_5.sqlite'));
    db.prepare('INSERT INTO threads VALUES (?, ?, ?)').run('a', FROM, null);
    db.close();

    const result = await migrateCodex(FROM, TO, { ...options(), dryRun: true });

    expect(await readFile(file, 'utf8')).toBe(before);
    expect(await readFile(join(codex, 'config.toml'), 'utf8')).toBe(
      `[projects."${FROM}"]\n`
    );
    const check = new DatabaseSync(join(codex, 'state_5.sqlite'));
    expect(check.prepare('SELECT cwd FROM threads').get()).toEqual({
      cwd: FROM
    });
    check.close();
    expect(result.changes).toHaveLength(3);
  });

  it('honours CODEX_HOME', async () => {
    const custom = join(home, 'elsewhere');
    await mkdir(custom);
    await writeFile(join(custom, 'config.toml'), `[projects."${FROM}"]\n`);
    await migrateCodex(FROM, TO, { ...options(), env: { CODEX_HOME: custom } });
    expect(await readFile(join(custom, 'config.toml'), 'utf8')).toBe(
      `[projects."${TO}"]\n`
    );
  });

  it('does nothing when Codex was never used', async () => {
    await rm(codex, { recursive: true });
    const result = await migrateCodex(FROM, TO, options());
    expect(result).toEqual({ tool: 'codex', changes: [], warnings: [] });
  });
});
