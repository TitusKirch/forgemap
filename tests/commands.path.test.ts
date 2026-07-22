import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pathCommand } from '../src/commands/path.ts';
import { runCli } from './helpers/citty.ts';

const FIXTURE_CONFIG = `export default {
  root: '.',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' },
    work: { type: 'gitlab', host: 'gitlab.acme.com', dir: 'comGitlabAcme' }
  }
};
`;

/** Repos that exist on disk, so the fuzzy fallback has something to scan. */
const CLONED: Array<[string, string, string]> = [
  ['comGithub', 'kirchDev', 'gildmaster'],
  ['comGithub', 'kirchDev', 'laravel-pbac'],
  ['comGithub', 'acme', 'gildhall']
];

async function setup(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'forgemap-path-test-'));
  await writeFile(join(dir, 'forgemap.config.ts'), FIXTURE_CONFIG, 'utf8');
  for (const [forgeDir, owner, repo] of CLONED) {
    await mkdir(join(dir, forgeDir, owner, repo), { recursive: true });
  }
  return dir;
}

/**
 * Drive the command through citty's real argument parsing (node:util
 * parseArgs under the hood) rather than hand-injecting an args object —
 * an injected `args` would bypass the very parsing a positional query
 * depends on.
 */
async function runPath(
  dir: string,
  ...argv: string[]
): Promise<{ out: string; exit: number | undefined }> {
  const { out, exit } = await runCli(pathCommand, [
    ...argv,
    '--config',
    join(dir, 'forgemap.config.ts')
  ]);
  return { out: out.trimEnd(), exit };
}

describe('pathCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await setup();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('prints the resolved local path for a short slug', async () => {
    const { out } = await runPath(dir, 'kirchDev/laravel-pbac');
    expect(out).toBe(join(dir, 'comGithub', 'kirchDev', 'laravel-pbac'));
  });

  it('prints the resolved path for a named forge', async () => {
    const { out } = await runPath(dir, 'work:team/api');
    expect(out).toBe(join(dir, 'comGitlabAcme', 'team', 'api'));
  });

  it('prints the resolved path for a full URL', async () => {
    const { out } = await runPath(dir, 'https://github.com/foo/bar.git');
    expect(out).toBe(join(dir, 'comGithub', 'foo', 'bar'));
  });

  it('resolves a bare fuzzy term to a single cloned repo', async () => {
    const { out, exit } = await runPath(dir, 'gildmaster');
    expect(out).toBe(join(dir, 'comGithub', 'kirchDev', 'gildmaster'));
    expect(exit).toBeUndefined();
  });

  it('resolves a partial fuzzy term to a single cloned repo', async () => {
    const { out } = await runPath(dir, 'pbac');
    expect(out).toBe(join(dir, 'comGithub', 'kirchDev', 'laravel-pbac'));
  });

  it('fails without printing a path when a fuzzy term is ambiguous', async () => {
    const { out, exit } = await runPath(dir, 'gild');
    expect(out).toBe('');
    expect(exit).toBe(1);
  });

  it('fails when a fuzzy term matches nothing', async () => {
    const { out, exit } = await runPath(dir, 'zzzznope');
    expect(out).toBe('');
    expect(exit).toBe(1);
  });

  it('prefers a strict slug over an ambiguous fuzzy term', async () => {
    const { out, exit } = await runPath(dir, 'acme/gildhall');
    expect(out).toBe(join(dir, 'comGithub', 'acme', 'gildhall'));
    expect(exit).toBeUndefined();
  });

  it('still resolves a strict slug for a repo that is not cloned', async () => {
    const { out } = await runPath(dir, 'nobody/nothing');
    expect(out).toBe(join(dir, 'comGithub', 'nobody', 'nothing'));
  });
  it('falls back to the cwd when no config file is discovered', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'forgemap-path-bare-'));
    await mkdir(join(bare, 'comGithub', 'kirchDev', 'gildmaster'), {
      recursive: true
    });
    const saved = process.cwd();
    const savedXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = join(bare, 'xdg-empty');
    process.chdir(bare);
    try {
      const { out } = await runCli(pathCommand, ['kirchDev/gildmaster']);
      expect(out.trim()).toBe(
        join(bare, 'comGithub', 'kirchDev', 'gildmaster')
      );
    } finally {
      process.chdir(saved);
      if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = savedXdg;
      await rm(bare, { recursive: true, force: true });
    }
  });
});
