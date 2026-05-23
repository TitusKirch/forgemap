import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { hasCommandMock, execCaptureMock } = vi.hoisted(() => ({
  hasCommandMock: vi.fn(),
  execCaptureMock: vi.fn()
}));

vi.mock('../src/utils/exec.ts', () => ({
  hasCommand: hasCommandMock,
  execCapture: execCaptureMock,
  execInherit: vi.fn()
}));

import { validateCommand } from '../src/commands/validate.ts';

const CONFIG_GITHUB = `export default {
  root: '.',
  defaultForge: 'github',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' }
  }
};
`;

const CONFIG_GIT = `export default {
  root: '.',
  defaultForge: 'work',
  forges: {
    work: { type: 'git', host: 'gitlab.acme.com', dir: 'comGitlabAcme' }
  }
};
`;

const CONFIG_BROKEN = `export default {
  root: '.',
  defaultForge: 'missing',
  forges: {
    github: { type: 'github', host: 'github.com', dir: 'comGithub' }
  }
};
`;

async function runValidate(
  dir: string,
  json = false
): Promise<{ out: string; exit: number | undefined }> {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  process.exitCode = undefined;
  try {
    await validateCommand.run!({
      args: { config: join(dir, 'forgemap.config.ts'), json, _: [] },
      rawArgs: [],
      cmd: validateCommand,
      data: undefined
    } as never);
  } finally {
    process.stdout.write = original;
  }
  return { out: writes.join(''), exit: process.exitCode };
}

describe('validateCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-validate-'));
    hasCommandMock.mockReset();
    execCaptureMock.mockReset();
    process.exitCode = undefined;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('passes for a valid github config with gh + auth', async () => {
    await writeFile(join(dir, 'forgemap.config.ts'), CONFIG_GITHUB, 'utf8');
    hasCommandMock.mockResolvedValue(true);
    execCaptureMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const { out, exit } = await runValidate(dir);
    expect(exit).toBeUndefined();
    expect(out).toContain('All checks passed');
    expect(out).toContain('gh auth');
  });

  it('warns (not fails) when gh is present but not logged in', async () => {
    await writeFile(join(dir, 'forgemap.config.ts'), CONFIG_GITHUB, 'utf8');
    hasCommandMock.mockResolvedValue(true);
    execCaptureMock.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'not logged in'
    });

    const { out, exit } = await runValidate(dir);
    expect(exit).toBeUndefined();
    expect(out).toContain('not logged in');
  });

  it('fails when git is missing', async () => {
    await writeFile(join(dir, 'forgemap.config.ts'), CONFIG_GIT, 'utf8');
    hasCommandMock.mockImplementation(async (cmd: string) => cmd !== 'git');

    const { out, exit } = await runValidate(dir);
    expect(exit).toBe(1);
    expect(out).toContain('git CLI');
    expect(out).toContain('Validation failed');
  });

  it('fails when defaultForge is not in forges', async () => {
    await writeFile(join(dir, 'forgemap.config.ts'), CONFIG_BROKEN, 'utf8');
    hasCommandMock.mockResolvedValue(true);
    execCaptureMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const { exit } = await runValidate(dir);
    expect(exit).toBe(1);
  });

  it('emits JSON with --json', async () => {
    await writeFile(join(dir, 'forgemap.config.ts'), CONFIG_GITHUB, 'utf8');
    hasCommandMock.mockResolvedValue(true);
    execCaptureMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const { out } = await runValidate(dir, true);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(
      parsed.checks.find((c: { name: string }) => c.name === 'gh auth')
    ).toBeDefined();
  });

  it('fails when the configured root does not exist', async () => {
    const missingRoot = `export default {
  root: './does-not-exist',
  defaultForge: 'github',
  forges: { github: { type: 'github', host: 'github.com', dir: 'gh' } }
};
`;
    await writeFile(join(dir, 'forgemap.config.ts'), missingRoot, 'utf8');
    hasCommandMock.mockResolvedValue(true);
    execCaptureMock.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    const { out, exit } = await runValidate(dir);
    expect(exit).toBe(1);
    expect(out).toMatch(/root directory.+does not exist/i);
  });
});
