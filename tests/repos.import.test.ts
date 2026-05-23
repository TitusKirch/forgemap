import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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

import {
  analyzeImport,
  deriveConfig,
  discoverForgemapLayout,
  type RepoReport
} from '../src/repos/import.ts';

interface RepoState {
  isRepo: boolean;
  origin?: string;
  remotes?: string[]; // names; defaults to ['origin'] when origin present
  lsRemote?: 'ok' | 'gone';
}

let repos: Record<string, RepoState> = {};
let ghResponses: Record<string, string> = {};

function ok(stdout: string) {
  return { code: 0, stdout: `${stdout}\n`, stderr: '' };
}
function fail(stderr = '') {
  return { code: 1, stdout: '', stderr };
}

beforeEach(() => {
  repos = {};
  ghResponses = {};
  hasCommandMock.mockReset();
  hasCommandMock.mockResolvedValue(true);
  execCaptureMock.mockReset();
  execCaptureMock.mockImplementation(
    async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      const cwd = opts?.cwd ?? '';
      const state = repos[cwd];
      if (cmd === 'git') {
        if (args[0] === 'rev-parse') {
          return state?.isRepo ? ok('true') : fail('not a git repo');
        }
        if (args[0] === 'config') {
          const names = state?.remotes ?? (state?.origin ? ['origin'] : []);
          const lines = names
            .map(
              (n) =>
                `remote.${n}.url ${n === 'origin' ? state?.origin : 'git@x:o/r.git'}`
            )
            .join('\n');
          return ok(lines);
        }
        if (args[0] === 'remote' && args[1] === 'get-url') {
          return state?.origin ? ok(state.origin) : fail('no origin');
        }
        if (args[0] === 'ls-remote') {
          // ls-remote runs without a cwd; match the repo by its origin URL.
          const match = Object.values(repos).find((s) => s.origin === args[1]);
          return match?.lsRemote === 'gone' ? fail('not found') : ok('');
        }
        if (args[0] === 'remote' && args[1] === 'set-url') return ok('');
      }
      if (cmd === 'gh' && args[0] === 'api' && args[1] === 'graphql') {
        // Resolve each aliased repository() lookup. A hit (full_name equals
        // the queried slug) returns a node; a miss returns null so the
        // adapter's REST fallback distinguishes moved from gone.
        const query = String(args[3] ?? '');
        const data: Record<string, { nameWithOwner: string } | null> = {};
        const re = /r(\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g;
        for (let m = re.exec(query); m; m = re.exec(query)) {
          const slug = `${m[2]}/${m[3]}`;
          data[`r${m[1]}`] =
            ghResponses[slug] === slug ? { nameWithOwner: slug } : null;
        }
        return ok(JSON.stringify({ data }));
      }
      if (cmd === 'gh' && args[0] === 'api') {
        const slug = String(args[1]).replace('repos/', '');
        const full = ghResponses[slug];
        return full ? ok(full) : fail('HTTP 404: Not Found');
      }
      return ok('');
    }
  );
});

describe('discoverForgemapLayout', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-import-disc-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('walks <server>/<owner>/<repo> and skips dotfiles', async () => {
    await mkdir(join(dir, 'github.com', 'foo', 'bar'), { recursive: true });
    await mkdir(join(dir, 'github.com', 'foo', 'baz'), { recursive: true });
    await mkdir(join(dir, '.hidden', 'x', 'y'), { recursive: true });

    const found = await discoverForgemapLayout(dir);
    expect(found).toHaveLength(2);
    expect(
      found.map((r) => `${r.serverDir}/${r.owner}/${r.repo}`).sort()
    ).toEqual(['github.com/foo/bar', 'github.com/foo/baz']);
  });

  it('returns empty for a missing path', async () => {
    expect(await discoverForgemapLayout(join(dir, 'nope'))).toEqual([]);
  });
});

describe('deriveConfig', () => {
  function report(serverDir: string, host: string | null): RepoReport {
    return {
      repo: { serverDir, owner: 'o', repo: 'r', localPath: '/x' },
      originUrl: null,
      originHost: host,
      remotes: [],
      findings: []
    };
  }

  it('maps github.com to a github forge, others to git', () => {
    const cfg = deriveConfig(
      [report('gh', 'github.com'), report('gl', 'gitlab.acme.com')],
      '/root'
    );
    expect(cfg.root).toBe('/root');
    expect(cfg.forges.gh).toEqual({
      type: 'github',
      host: 'github.com',
      dir: 'gh'
    });
    expect(cfg.forges.gl).toEqual({
      type: 'git',
      host: 'gitlab.acme.com',
      dir: 'gl'
    });
  });

  it('prefers a github forge as defaultForge', () => {
    const cfg = deriveConfig(
      [
        report('gl', 'gitlab.acme.com'),
        report('gl', 'gitlab.acme.com'),
        report('gh', 'github.com')
      ],
      '/root'
    );
    expect(cfg.defaultForge).toBe('gh');
  });
});

describe('analyzeImport', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'forgemap-import-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function makeRepo(serverDir: string, owner: string, repo: string) {
    const local = join(dir, serverDir, owner, repo);
    await mkdir(local, { recursive: true });
    return local;
  }

  it('reports no issues when folder, origin, and remote agree', async () => {
    const local = await makeRepo('github.com', 'foo', 'bar');
    repos[local] = { isRepo: true, origin: 'git@github.com:foo/bar.git' };
    ghResponses['foo/bar'] = 'foo/bar';

    const result = await analyzeImport({
      path: dir,
      type: 'forgemap',
      remoteCheck: true
    });
    expect(
      result.reports[0]!.findings.filter((f) => f.severity !== 'ok')
    ).toEqual([]);
    expect(result.derived.forges['github.com']!.type).toBe('github');
  });

  it('flags origin-mismatch and suggests a folder move', async () => {
    const local = await makeRepo('github.com', 'foo', 'bar');
    repos[local] = { isRepo: true, origin: 'git@github.com:foo/renamed.git' };
    ghResponses['foo/renamed'] = 'foo/renamed';

    const result = await analyzeImport({
      path: dir,
      type: 'forgemap',
      remoteCheck: true
    });
    const finding = result.reports[0]!.findings.find(
      (f) => f.kind === 'origin-mismatch'
    );
    expect(finding?.fix).toEqual({
      action: 'move-folder',
      from: local,
      to: join(dir, 'github.com', 'foo', 'renamed')
    });
  });

  it('flags no-origin', async () => {
    const local = await makeRepo('github.com', 'foo', 'bar');
    repos[local] = { isRepo: true };
    const result = await analyzeImport({
      path: dir,
      type: 'forgemap',
      remoteCheck: true
    });
    expect(
      result.reports[0]!.findings.some((f) => f.kind === 'no-origin')
    ).toBe(true);
  });

  it('flags not-a-git-repo', async () => {
    const local = await makeRepo('github.com', 'foo', 'bar');
    repos[local] = { isRepo: false };
    const result = await analyzeImport({
      path: dir,
      type: 'forgemap',
      remoteCheck: true
    });
    expect(result.reports[0]!.findings[0]!.kind).toBe('not-a-git-repo');
  });

  it('detects a moved github repo and suggests a set-origin-url fix', async () => {
    const local = await makeRepo('github.com', 'old', 'bar');
    repos[local] = { isRepo: true, origin: 'git@github.com:old/bar.git' };
    ghResponses['old/bar'] = 'new/bar';

    const result = await analyzeImport({
      path: dir,
      type: 'forgemap',
      remoteCheck: true
    });
    const finding = result.reports[0]!.findings.find(
      (f) => f.kind === 'remote-moved'
    );
    expect(finding?.fix).toEqual({
      action: 'set-origin-url',
      localPath: local,
      url: 'https://github.com/new/bar.git'
    });
  });

  it('detects a gone github repo', async () => {
    const local = await makeRepo('github.com', 'foo', 'bar');
    repos[local] = { isRepo: true, origin: 'git@github.com:foo/bar.git' };
    // no ghResponses entry → 404

    const result = await analyzeImport({
      path: dir,
      type: 'forgemap',
      remoteCheck: true
    });
    expect(
      result.reports[0]!.findings.some((f) => f.kind === 'remote-gone')
    ).toBe(true);
  });

  it('skips the network check with remoteCheck=false', async () => {
    const local = await makeRepo('github.com', 'foo', 'bar');
    repos[local] = { isRepo: true, origin: 'git@github.com:foo/bar.git' };

    const result = await analyzeImport({
      path: dir,
      type: 'forgemap',
      remoteCheck: false
    });
    expect(
      result.reports[0]!.findings.some((f) => f.kind === 'remote-check-skipped')
    ).toBe(true);
    const ghCalls = execCaptureMock.mock.calls.filter((c) => c[0] === 'gh');
    expect(ghCalls).toHaveLength(0);
  });

  it('reports remote-gone for a git forge when ls-remote fails', async () => {
    const local = await makeRepo('git.acme.com', 'team', 'api');
    repos[local] = {
      isRepo: true,
      origin: 'git@git.acme.com:team/api.git',
      lsRemote: 'gone'
    };
    const result = await analyzeImport({
      path: dir,
      type: 'forgemap',
      remoteCheck: true
    });
    expect(result.derived.forges['git.acme.com']!.type).toBe('git');
    expect(
      result.reports[0]!.findings.some((f) => f.kind === 'remote-gone')
    ).toBe(true);
  });
});
