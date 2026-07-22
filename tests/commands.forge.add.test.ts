import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import consola from 'consola';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgeAddCommand } from '../src/commands/forge/add.ts';
import { runCli } from './helpers/citty.ts';

const CONFIG = `export default {
  root: '.',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' }
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

describe('forge add', () => {
  let dir: string;
  let cwd: string;
  let savedXdg: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-add-'));
    cwd = process.cwd();
    process.chdir(dir);
    // Keep a real ~/.config/forgemap out of the candidate list — it would show
    // up as an extra target and turn single-candidate cases into a select.
    savedXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(dir, 'xdg-empty');
    process.exitCode = undefined;
    setTTY(false);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.chdir(cwd);
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    await rm(dir, { recursive: true, force: true });
    process.exitCode = undefined;
    setTTY(false);
  });

  const config = join('forgemap.config.ts');

  it('adds a forge to an existing config via flags', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeAddCommand, [
      'work',
      '--type',
      'git',
      '--host',
      'git.example.com',
      '--dir',
      'work',
      '--yes'
    ]);
    expect(res.exit).toBeUndefined();
    const written = await readFile(config, 'utf8');
    expect(written).toContain('work: {');
    expect(written).toContain("host: 'git.example.com'");
    // github forge is preserved
    expect(written).toContain('github: {');
  });

  it('creates a fresh config when none exists', async () => {
    await runCli(forgeAddCommand, [
      'gh',
      '--type',
      'github',
      '--host',
      'github.com',
      '--dir',
      'comGithub',
      '--yes'
    ]);
    const written = await readFile(config, 'utf8');
    expect(written).toContain("defaultForge: 'gh'");
    expect(written).toContain('gh: {');
  });

  it('falls back to the default host for a hosted type', async () => {
    await writeFile(config, CONFIG);
    await runCli(forgeAddCommand, [
      'gl',
      '--type',
      'gitlab',
      '--dir',
      'comGitlab',
      '--yes'
    ]);
    const written = await readFile(config, 'utf8');
    expect(written).toContain("host: 'gitlab.com'");
  });

  it('sets the forge as default with --default', async () => {
    await writeFile(config, CONFIG);
    await runCli(forgeAddCommand, [
      'work',
      '--type',
      'git',
      '--host',
      'h',
      '--dir',
      'd',
      '--default',
      '--yes'
    ]);
    const written = await readFile(config, 'utf8');
    expect(written).toContain("defaultForge: 'work'");
  });

  it('keeps protocol only for https', async () => {
    await writeFile(config, CONFIG);
    await runCli(forgeAddCommand, [
      'sshf',
      '--type',
      'git',
      '--host',
      'h',
      '--dir',
      'd',
      '--protocol',
      'ssh',
      '--yes'
    ]);
    await runCli(forgeAddCommand, [
      'httpsf',
      '--type',
      'git',
      '--host',
      'h',
      '--dir',
      'd2',
      '--protocol',
      'https',
      '--yes'
    ]);
    const written = await readFile(config, 'utf8');
    expect(written).toContain("protocol: 'https'");
    // the ssh forge carries no protocol line of its own
    expect(written.match(/protocol:/g)).toHaveLength(1);
  });

  it('rejects a duplicate key', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeAddCommand, [
      'github',
      '--type',
      'github',
      '--host',
      'x',
      '--dir',
      'y',
      '--yes'
    ]);
    expect(res.exit).toBe(1);
    const written = await readFile(config, 'utf8');
    expect(written).toContain("host: 'github.com'");
  });

  it('rejects an invalid type', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeAddCommand, [
      'x',
      '--type',
      'bitbucket',
      '--host',
      'h',
      '--dir',
      'd',
      '--yes'
    ]);
    expect(res.exit).toBe(1);
  });

  it('rejects an invalid protocol', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeAddCommand, [
      'x',
      '--type',
      'git',
      '--host',
      'h',
      '--dir',
      'd',
      '--protocol',
      'ftp',
      '--yes'
    ]);
    expect(res.exit).toBe(1);
  });

  it('requires a host when the type has no default (non-interactive)', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeAddCommand, [
      'g',
      '--type',
      'gitea',
      '--dir',
      'd',
      '--yes'
    ]);
    expect(res.exit).toBe(1);
  });

  it('prompts for every field when interactive', async () => {
    await writeFile(config, CONFIG);
    setTTY(true);
    const prompt = vi
      .spyOn(consola, 'prompt')
      .mockResolvedValueOnce('work') // key
      .mockResolvedValueOnce('git') // type
      .mockResolvedValueOnce('h') // host
      .mockResolvedValueOnce('d') // dir
      .mockResolvedValueOnce('ssh') // protocol
      .mockResolvedValueOnce(false) // set as default?
      .mockResolvedValueOnce(true); // apply?
    await runCli(forgeAddCommand, []);
    expect(prompt).toHaveBeenCalledTimes(7);
    const written = await readFile(config, 'utf8');
    expect(written).toContain('work: {');
    expect(written).toContain("defaultForge: 'github'");
  });

  it('does nothing when the apply confirmation is declined', async () => {
    await writeFile(config, CONFIG);
    setTTY(true);
    vi.spyOn(consola, 'prompt')
      .mockResolvedValueOnce('work')
      .mockResolvedValueOnce('github')
      .mockResolvedValueOnce('github.com')
      .mockResolvedValueOnce('d')
      .mockResolvedValueOnce(false) // set as default?
      .mockResolvedValueOnce(false); // apply? → declined
    await runCli(forgeAddCommand, []);
    const written = await readFile(config, 'utf8');
    expect(written).not.toContain('work: {');
  });

  it('aborts when a prompt is cancelled', async () => {
    await writeFile(config, CONFIG);
    setTTY(true);
    vi.spyOn(consola, 'prompt').mockResolvedValueOnce(CANCELLED); // key cancelled
    const res = await runCli(forgeAddCommand, []);
    expect(res.exit).toBeUndefined();
    const written = await readFile(config, 'utf8');
    expect(written).not.toContain('work: {');
  });

  it('writes to the file given by --config', async () => {
    await mkdir('nested');
    const target = join('nested', 'forgemap.config.ts');
    await writeFile(target, CONFIG);
    await runCli(forgeAddCommand, [
      'work',
      '--type',
      'git',
      '--host',
      'h',
      '--dir',
      'd',
      '--config',
      target,
      '--yes'
    ]);
    const written = await readFile(target, 'utf8');
    expect(written).toContain('work: {');
  });

  it('creates the file given by --config when it does not exist', async () => {
    await mkdir('nested');
    const target = join('nested', 'forgemap.config.ts');
    await runCli(forgeAddCommand, [
      'gh',
      '--type',
      'github',
      '--dir',
      'comGithub',
      '--config',
      target,
      '--yes'
    ]);
    const written = await readFile(target, 'utf8');
    expect(written).toContain("defaultForge: 'gh'");
  });

  it('prompts for the target file when several configs are in scope', async () => {
    await writeFile(config, CONFIG);
    await mkdir('nested');
    const nested = join('nested', 'forgemap.config.ts');
    await writeFile(nested, CONFIG);
    process.chdir(join(dir, 'nested'));
    setTTY(true);
    const outer = join(dir, 'forgemap.config.ts');
    const prompt = vi
      .spyOn(consola, 'prompt')
      .mockResolvedValueOnce('work') // key
      .mockResolvedValueOnce('github') // type
      .mockResolvedValueOnce('github.com') // host
      .mockResolvedValueOnce('d') // dir
      .mockResolvedValueOnce(false) // set as default?
      .mockResolvedValueOnce(outer) // which config file?
      .mockResolvedValueOnce(true); // apply?
    await runCli(forgeAddCommand, []);
    expect(prompt).toHaveBeenCalledTimes(7);
    expect(await readFile(outer, 'utf8')).toContain('work: {');
    expect(await readFile(join(dir, nested), 'utf8')).not.toContain('work: {');
  });

  it('aborts when the target-file select is cancelled', async () => {
    await writeFile(config, CONFIG);
    await mkdir('nested');
    const nested = join('nested', 'forgemap.config.ts');
    await writeFile(nested, CONFIG);
    process.chdir(join(dir, 'nested'));
    setTTY(true);
    vi.spyOn(consola, 'prompt')
      .mockResolvedValueOnce('work')
      .mockResolvedValueOnce('github')
      .mockResolvedValueOnce('github.com')
      .mockResolvedValueOnce('d')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(CANCELLED); // target select cancelled
    await runCli(forgeAddCommand, []);
    expect(await readFile(join(dir, config), 'utf8')).not.toContain('work: {');
    expect(await readFile(join(dir, nested), 'utf8')).not.toContain('work: {');
  });

  it('prints the change for manual application when the config cannot be rewritten', async () => {
    await writeFile(config, 'export const notDefault = 1;\n');
    const log = vi.spyOn(consola, 'log').mockImplementation(() => {});
    const res = await runCli(forgeAddCommand, [
      'work',
      '--type',
      'git',
      '--host',
      'git.example.com',
      '--dir',
      'work',
      '--protocol',
      'https',
      '--yes'
    ]);
    expect(res.exit).toBe(1);
    const printed = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('work: {');
    expect(printed).toContain("host: 'git.example.com'");
    expect(printed).toContain("protocol: 'https'");
    // the file itself is untouched
    expect(await readFile(config, 'utf8')).toBe(
      'export const notDefault = 1;\n'
    );
  });

  it('rejects an empty forge key', async () => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeAddCommand, [
      '   ',
      '--type',
      'github',
      '--dir',
      'd',
      '--yes'
    ]);
    expect(res.exit).toBe(1);
  });

  it.each([
    ['type', ['x', '--dir', 'd']],
    ['directory', ['x', '--type', 'github']]
  ])('requires a %s when non-interactive', async (_field, argv) => {
    await writeFile(config, CONFIG);
    const res = await runCli(forgeAddCommand, [...argv, '--yes']);
    expect(res.exit).toBe(1);
  });

  it.each([
    ['type', 1],
    ['host', 2],
    ['directory', 3]
  ])('aborts when the %s prompt is cancelled', async (_field, step) => {
    await writeFile(config, CONFIG);
    setTTY(true);
    const prompt = vi.spyOn(consola, 'prompt').mockResolvedValueOnce('work'); // key
    // walk to the prompt under test, answering the earlier ones
    const earlier = ['github', 'github.com'];
    for (let i = 1; i < step; i++)
      prompt.mockResolvedValueOnce(earlier[i - 1]!);
    prompt.mockResolvedValueOnce(CANCELLED);
    await runCli(forgeAddCommand, []);
    expect(await readFile(config, 'utf8')).not.toContain('work: {');
  });

  it('falls back to the suggested host when the host prompt is left empty', async () => {
    await writeFile(config, CONFIG);
    setTTY(true);
    vi.spyOn(consola, 'prompt')
      .mockResolvedValueOnce('gl') // key
      .mockResolvedValueOnce('gitlab') // type
      .mockResolvedValueOnce('') // host → suggested
      .mockResolvedValueOnce('comGitlab') // dir
      .mockResolvedValueOnce(false) // set as default?
      .mockResolvedValueOnce(true); // apply?
    await runCli(forgeAddCommand, []);
    expect(await readFile(config, 'utf8')).toContain("host: 'gitlab.com'");
  });

  it.each([
    ['cancelled', CANCELLED],
    ['not a protocol', 'ftp']
  ])(
    'adds a git forge without a protocol when the prompt is %s',
    async (_case, answer) => {
      await writeFile(config, CONFIG);
      setTTY(true);
      vi.spyOn(consola, 'prompt')
        .mockResolvedValueOnce('work') // key
        .mockResolvedValueOnce('git') // type
        .mockResolvedValueOnce('git.example.com') // host
        .mockResolvedValueOnce('work') // dir
        .mockResolvedValueOnce(answer) // protocol
        .mockResolvedValueOnce(false) // set as default?
        .mockResolvedValueOnce(true); // apply?
      await runCli(forgeAddCommand, []);
      const written = await readFile(config, 'utf8');
      expect(written).toContain('work: {');
      expect(written).not.toContain('protocol');
    }
  );

  it('renders the protocol into a freshly created config', async () => {
    await runCli(forgeAddCommand, [
      'work',
      '--type',
      'git',
      '--host',
      'git.example.com',
      '--dir',
      'work',
      '--protocol',
      'https',
      '--yes'
    ]);
    expect(await readFile(config, 'utf8')).toContain("protocol: 'https'");
  });

  it('fails when the config to create is already there under another extension', async () => {
    await mkdir('nested');
    // --config names a file that does not exist, so `add` takes the create
    // path — but writeConfigFile always writes forgemap.config.ts, which does.
    await writeFile(join('nested', 'forgemap.config.ts'), CONFIG);
    const res = await runCli(forgeAddCommand, [
      'work',
      '--type',
      'github',
      '--dir',
      'd',
      '--config',
      join('nested', 'forgemap.config.mjs'),
      '--yes'
    ]);
    expect(res.exit).toBe(1);
  });
});
