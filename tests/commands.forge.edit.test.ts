import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import consola from 'consola';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgeEditCommand } from '../src/commands/forge/edit.ts';
import { runCli } from './helpers/citty.ts';

const CONFIG = `export default {
  root: '.',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' },
    work: { type: 'git', host: 'git.example.com', dir: 'work', protocol: 'https' }
  }
};
`;

/** consola.prompt resolves to null on cancel; its types don't model that. */
const CANCELLED = null as unknown as string;

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    value,
    configurable: true
  });
}

describe('forge edit', () => {
  let dir: string;
  let cwd: string;
  const config = 'forgemap.config.ts';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-edit-'));
    cwd = process.cwd();
    process.chdir(dir);
    process.exitCode = undefined;
    setTTY(false);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
    process.exitCode = undefined;
    setTTY(false);
  });

  it('edits host and dir via flags', async () => {
    await writeFile(config, CONFIG);
    await runCli(forgeEditCommand, [
      'github',
      '--host',
      'ghe.example.com',
      '--dir',
      'gh',
      '--yes'
    ]);
    const written = await readFile(config, 'utf8');
    expect(written).toContain("host: 'ghe.example.com'");
    expect(written).toContain("dir: 'gh'");
  });

  it('switches type to git and sets a protocol', async () => {
    await writeFile(config, CONFIG);
    await runCli(forgeEditCommand, [
      'github',
      '--type',
      'git',
      '--protocol',
      'https',
      '--yes'
    ]);
    const written = await readFile(config, 'utf8');
    expect(written).toContain("type: 'git'");
    expect(written).toContain("protocol: 'https'");
  });

  it('drops protocol when the type is no longer git', async () => {
    await writeFile(config, CONFIG);
    await runCli(forgeEditCommand, ['work', '--type', 'github', '--yes']);
    const written = await readFile(config, 'utf8');
    expect(written).not.toContain('protocol');
  });

  it('errors when nothing would change (non-interactive)', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeEditCommand, ['github', '--yes']);
    expect(res.exit).toBe(1);
  });

  it('rejects an unknown forge key', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeEditCommand, [
      'nope',
      '--host',
      'x',
      '--yes'
    ]);
    expect(res.exit).toBe(1);
  });

  it('errors when there is no config file', async () => {
    const res = await runCli(forgeEditCommand, ['github', '--host', 'x']);
    expect(res.exit).toBe(1);
  });

  it('rejects an invalid type', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeEditCommand, [
      'github',
      '--type',
      'bad',
      '--yes'
    ]);
    expect(res.exit).toBe(1);
  });

  it('rejects an invalid protocol', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeEditCommand, [
      'work',
      '--protocol',
      'ftp',
      '--yes'
    ]);
    expect(res.exit).toBe(1);
  });

  it('prompts for fields when interactive', async () => {
    await writeFile(config, CONFIG);
    setTTY(true);
    const prompt = vi
      .spyOn(consola, 'prompt')
      .mockResolvedValueOnce('github') // which forge
      .mockResolvedValueOnce('github') // type (kept)
      .mockResolvedValueOnce('newhost.com') // host
      .mockResolvedValueOnce('newdir') // dir
      .mockResolvedValueOnce(true); // apply?
    await runCli(forgeEditCommand, []);
    expect(prompt).toHaveBeenCalledTimes(5);
    const written = await readFile(config, 'utf8');
    expect(written).toContain("host: 'newhost.com'");
    expect(written).toContain("dir: 'newdir'");
  });

  it('keeps the current value when a field prompt is left empty', async () => {
    await writeFile(config, CONFIG);
    setTTY(true);
    vi.spyOn(consola, 'prompt')
      .mockResolvedValueOnce('github') // which forge
      .mockResolvedValueOnce('github') // type
      .mockResolvedValueOnce('') // host → keep
      .mockResolvedValueOnce('') // dir → keep
      .mockResolvedValueOnce(true); // apply?
    await runCli(forgeEditCommand, []);
    const written = await readFile(config, 'utf8');
    expect(written).toContain("host: 'github.com'");
    expect(written).toContain("dir: 'comGithub'");
  });

  it('aborts when the forge selection is cancelled', async () => {
    await writeFile(config, CONFIG);
    setTTY(true);
    vi.spyOn(consola, 'prompt').mockResolvedValueOnce(CANCELLED);
    await runCli(forgeEditCommand, []);
    const written = await readFile(config, 'utf8');
    expect(written).toContain("host: 'github.com'");
  });

  it('requires a key when non-interactive', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeEditCommand, ['--host', 'x', '--yes']);
    expect(res.exit).toBe(1);
  });

  it.each([
    ['type', 1],
    ['host', 2],
    ['dir', 3]
  ])('aborts when the %s prompt is cancelled', async (_field, step) => {
    await writeFile(config, CONFIG);
    setTTY(true);
    const prompt = vi.spyOn(consola, 'prompt').mockResolvedValueOnce('github'); // which forge
    for (let i = 1; i < step; i++) prompt.mockResolvedValueOnce('github');
    prompt.mockResolvedValueOnce(CANCELLED);
    await runCli(forgeEditCommand, []);
    const written = await readFile(config, 'utf8');
    expect(written).toContain("host: 'github.com'");
    expect(written).toContain("dir: 'comGithub'");
  });

  it('ignores a type answer that is not a forge type', async () => {
    await writeFile(config, CONFIG);
    setTTY(true);
    vi.spyOn(consola, 'prompt')
      .mockResolvedValueOnce('github') // which forge
      .mockResolvedValueOnce('bitbucket') // type → not a ForgeType, ignored
      .mockResolvedValueOnce('newhost.com') // host
      .mockResolvedValueOnce('') // dir → keep
      .mockResolvedValueOnce(true); // apply?
    await runCli(forgeEditCommand, []);
    const written = await readFile(config, 'utf8');
    expect(written).toContain("type: 'github'");
    expect(written).toContain("host: 'newhost.com'");
  });

  it('keeps the protocol when editing a git forge non-interactively', async () => {
    await writeFile(config, CONFIG);
    await runCli(forgeEditCommand, [
      'work',
      '--host',
      'new.example.com',
      '--yes'
    ]);
    const written = await readFile(config, 'utf8');
    expect(written).toContain("host: 'new.example.com'");
    expect(written).toContain("protocol: 'https'");
  });

  it.each([
    ['cancelled', CANCELLED],
    ['not a protocol', 'ftp']
  ])(
    'leaves the protocol alone when the prompt is %s',
    async (_case, answer) => {
      await writeFile(config, CONFIG);
      setTTY(true);
      vi.spyOn(consola, 'prompt')
        .mockResolvedValueOnce('work') // which forge
        .mockResolvedValueOnce('git') // type
        .mockResolvedValueOnce('new.example.com') // host
        .mockResolvedValueOnce('') // dir → keep
        .mockResolvedValueOnce(answer) // protocol
        .mockResolvedValueOnce(true); // apply?
      await runCli(forgeEditCommand, []);
      const written = await readFile(config, 'utf8');
      expect(written).toContain("host: 'new.example.com'");
      expect(written).toContain("protocol: 'https'");
    }
  );

  it('does nothing when the apply confirmation is declined', async () => {
    await writeFile(config, CONFIG);
    setTTY(true);
    vi.spyOn(consola, 'prompt')
      .mockResolvedValueOnce('github') // which forge
      .mockResolvedValueOnce('github') // type
      .mockResolvedValueOnce('newhost.com') // host
      .mockResolvedValueOnce('') // dir → keep
      .mockResolvedValueOnce(false); // apply? → declined
    await runCli(forgeEditCommand, []);
    const written = await readFile(config, 'utf8');
    expect(written).toContain("host: 'github.com'");
  });

  it('edits the file given by --config', async () => {
    await mkdir('nested');
    const target = join('nested', 'forgemap.config.ts');
    await writeFile(target, CONFIG);
    await runCli(forgeEditCommand, [
      'github',
      '--dir',
      'gh',
      '--config',
      target,
      '--yes'
    ]);
    expect(await readFile(target, 'utf8')).toContain("dir: 'gh'");
  });

  it('prints the change for manual application when the config cannot be rewritten', async () => {
    await writeFile(config, 'export const notDefault = 1;\n');
    const log = vi.spyOn(consola, 'log').mockImplementation(() => {});
    // Only the built-in github forge is in effect here, so edit that one.
    const res = await runCli(forgeEditCommand, [
      'github',
      '--host',
      'ghe.example.com',
      '--yes'
    ]);
    expect(res.exit).toBe(1);
    const printed = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('github: {');
    expect(printed).toContain("host: 'ghe.example.com'");
    // a github forge carries no protocol line
    expect(printed).not.toContain('protocol');
  });
  it('sets the protocol from the prompt on a git forge', async () => {
    await writeFile(config, CONFIG);
    setTTY(true);
    vi.spyOn(consola, 'prompt')
      .mockResolvedValueOnce('work') // which forge
      .mockResolvedValueOnce('git') // type
      .mockResolvedValueOnce('') // host → keep
      .mockResolvedValueOnce('') // dir → keep
      .mockResolvedValueOnce('ssh') // protocol
      .mockResolvedValueOnce(true); // apply?
    await runCli(forgeEditCommand, []);
    expect(await readFile(config, 'utf8')).toContain("protocol: 'ssh'");
  });
});
