import { readdir } from 'node:fs/promises';
import { join } from 'pathe';
import type {
  ForgeConfig,
  ForgeMapConfig,
  ForgeType
} from '../config/schema.ts';
import { getForgeAdapter } from '../forges/registry.ts';
import type { RemoteCheckInput, RemoteCheckResult } from '../forges/types.ts';
import { mapLimit } from '../utils/concurrency.ts';
import { parseSlug } from '../slug/parse.ts';
import { getOriginUrl, getRemotes, isGitRepo, type GitRemote } from './git.ts';

/** Layout kinds importable today. `forgemap` = the `<server>/<owner>/<repo>`
 *  tree forgemap itself manages. Kept as an enum to extend later. */
export type ImportType = 'forgemap';

export interface ImportOptions {
  /** Absolute path to scan (already expanded/resolved). */
  path: string;
  type: ImportType;
  /** Run the per-forge network existence/move check. Default true. */
  remoteCheck: boolean;
  /** Called as remote checks complete, for progress reporting. */
  onProgress?: (done: number, total: number) => void;
}

export interface DiscoveredRepo {
  serverDir: string;
  owner: string;
  repo: string;
  localPath: string;
}

export type FindingKind =
  | 'not-a-git-repo'
  | 'no-origin'
  | 'multiple-remotes'
  | 'origin-mismatch'
  | 'remote-moved'
  | 'remote-gone'
  | 'host-unmatched'
  | 'remote-check-skipped'
  | 'remote-check-unknown';

export type FindingSeverity = 'ok' | 'warn' | 'fail';

export type Fix =
  | { action: 'move-folder'; from: string; to: string }
  | { action: 'set-origin-url'; localPath: string; url: string };

export interface Finding {
  kind: FindingKind;
  severity: FindingSeverity;
  message: string;
  fix?: Fix;
}

export interface RepoReport {
  repo: DiscoveredRepo;
  originUrl: string | null;
  /** Host parsed from the origin URL, when parseable. Drives config derivation. */
  originHost: string | null;
  remotes: GitRemote[];
  findings: Finding[];
}

export interface DerivedConfig extends ForgeMapConfig {}

export interface ImportResult {
  root: string;
  derived: DerivedConfig;
  reports: RepoReport[];
}

async function listDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Structure-driven depth-3 walk of `<path>/<serverDir>/<owner>/<repo>`.
 * Unlike `scanRepos`, this is config-free: every top-level directory is a
 * candidate server dir, and the names are discovered rather than configured.
 */
export async function discoverForgemapLayout(
  path: string
): Promise<DiscoveredRepo[]> {
  const repos: DiscoveredRepo[] = [];
  for (const serverDir of await listDirs(path)) {
    const serverPath = join(path, serverDir);
    for (const owner of await listDirs(serverPath)) {
      const ownerPath = join(serverPath, owner);
      for (const repo of await listDirs(ownerPath)) {
        repos.push({
          serverDir,
          owner,
          repo,
          localPath: join(ownerPath, repo)
        });
      }
    }
  }
  return repos;
}

function forgeTypeForHost(host: string): ForgeType {
  return host === 'github.com' ? 'github' : 'git';
}

/**
 * Derive a `root` + one forge per server dir from the analyzed reports.
 * Host (and therefore type) come from the dominant origin host of the repos
 * under each server dir.
 */
export function deriveConfig(
  reports: RepoReport[],
  path: string
): DerivedConfig {
  const forges: Record<string, ForgeConfig> = {};
  const counts = new Map<string, number>();

  const byServer = new Map<string, RepoReport[]>();
  for (const report of reports) {
    const list = byServer.get(report.repo.serverDir);
    if (list) list.push(report);
    else byServer.set(report.repo.serverDir, [report]);
  }

  for (const [serverDir, group] of byServer) {
    counts.set(serverDir, group.length);
    const hostTally = new Map<string, number>();
    for (const report of group) {
      if (report.originHost) {
        hostTally.set(
          report.originHost,
          (hostTally.get(report.originHost) ?? 0) + 1
        );
      }
    }
    const host =
      [...hostTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const type = host ? forgeTypeForHost(host) : 'git';
    forges[serverDir] = { type, host, dir: serverDir } as ForgeConfig;
  }

  // Prefer a github forge, then the one with the most repos.
  const names = Object.keys(forges);
  const defaultForge =
    names.slice().sort((a, b) => {
      const aGh = forges[a]!.type === 'github' ? 1 : 0;
      const bGh = forges[b]!.type === 'github' ? 1 : 0;
      if (aGh !== bGh) return bGh - aGh;
      return (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    })[0] ?? '';

  return { root: path, defaultForge, forges };
}

/** Parsed origin identity carried between the local and remote phases. */
interface ParsedOrigin {
  host?: string;
  owner: string;
  repo: string;
}

/** Local phase: git reads + offline folder-vs-origin reconciliation. No network. */
async function analyzeLocal(
  repo: DiscoveredRepo,
  options: ImportOptions
): Promise<{ report: RepoReport; parsed: ParsedOrigin | null }> {
  const report: RepoReport = {
    repo,
    originUrl: null,
    originHost: null,
    remotes: [],
    findings: []
  };

  if (!(await isGitRepo(repo.localPath))) {
    report.findings.push({
      kind: 'not-a-git-repo',
      severity: 'warn',
      message: 'not a git repository'
    });
    return { report, parsed: null };
  }

  report.remotes = await getRemotes(repo.localPath);
  report.originUrl = await getOriginUrl(repo.localPath);

  if (!report.originUrl) {
    const names = report.remotes
      .map((r) => r.name)
      .filter((n) => n !== 'origin');
    report.findings.push({
      kind: 'no-origin',
      severity: 'warn',
      message:
        names.length > 0
          ? `no origin remote (other remotes: ${names.join(', ')})`
          : 'no origin remote'
    });
    return { report, parsed: null };
  }

  if (report.remotes.length > 1) {
    report.findings.push({
      kind: 'multiple-remotes',
      severity: 'warn',
      message: `${report.remotes.length} remotes configured; comparing origin`
    });
  }

  let parsed: ParsedOrigin | null = null;
  try {
    parsed = parseSlug(report.originUrl);
    report.originHost = parsed.host ?? null;
  } catch {
    report.findings.push({
      kind: 'origin-mismatch',
      severity: 'warn',
      message: `could not parse origin URL: ${report.originUrl}`
    });
  }

  if (parsed && (parsed.owner !== repo.owner || parsed.repo !== repo.repo)) {
    const to = join(options.path, repo.serverDir, parsed.owner, parsed.repo);
    report.findings.push({
      kind: 'origin-mismatch',
      severity: 'warn',
      message: `folder ${repo.owner}/${repo.repo} != origin ${parsed.owner}/${parsed.repo}`,
      fix: { action: 'move-folder', from: repo.localPath, to }
    });
  }

  return { report, parsed };
}

/** Translate a remote-check result into a finding on the report. */
function pushRemoteFinding(
  report: RepoReport,
  parsed: ParsedOrigin,
  result: RemoteCheckResult,
  path: string
): void {
  const { repo } = report;
  switch (result.state) {
    case 'exists':
      break;
    case 'moved': {
      const to = join(
        path,
        repo.serverDir,
        result.canonical.owner,
        result.canonical.repo
      );
      const fix: Fix | undefined = result.canonicalUrl
        ? {
            action: 'set-origin-url',
            localPath: repo.localPath,
            url: result.canonicalUrl
          }
        : to !== repo.localPath
          ? { action: 'move-folder', from: repo.localPath, to }
          : undefined;
      report.findings.push({
        kind: 'remote-moved',
        severity: 'warn',
        message: `remote moved to ${result.canonical.owner}/${result.canonical.repo}`,
        fix
      });
      break;
    }
    case 'gone':
      report.findings.push({
        kind: 'remote-gone',
        severity: 'warn',
        message: `remote ${parsed.owner}/${parsed.repo} no longer exists`
      });
      break;
    case 'unknown':
      report.findings.push({
        kind: 'remote-check-unknown',
        severity: 'warn',
        message: `remote check inconclusive: ${result.reason}`
      });
      break;
  }
}

/** A repo that has a parseable origin and is therefore eligible for the
 *  network check, paired with its derived forge. */
interface Checkable {
  report: RepoReport;
  parsed: ParsedOrigin;
}

/** Run the network check for one forge's repos, preferring the batched
 *  adapter method and falling back to a concurrency-limited per-repo loop. */
async function checkForgeGroup(
  forge: ForgeConfig,
  items: Checkable[],
  options: ImportOptions,
  bump: () => void
): Promise<void> {
  const inputs: RemoteCheckInput[] = items.map((it) => ({
    forge,
    owner: it.parsed.owner,
    repo: it.parsed.repo,
    originUrl: it.report.originUrl ?? undefined
  }));

  let adapter: ReturnType<typeof getForgeAdapter>;
  try {
    adapter = getForgeAdapter(forge.type);
  } catch (error) {
    for (const it of items) {
      it.report.findings.push({
        kind: 'remote-check-unknown',
        severity: 'warn',
        message: `remote check inconclusive: ${(error as Error).message}`
      });
      bump();
    }
    return;
  }

  if (adapter.checkRemotes) {
    let results: RemoteCheckResult[];
    try {
      results = await adapter.checkRemotes(inputs);
    } catch (error) {
      results = inputs.map(() => ({
        state: 'unknown',
        reason: (error as Error).message
      }));
    }
    items.forEach((it, i) => {
      pushRemoteFinding(it.report, it.parsed, results[i]!, options.path);
      bump();
    });
    return;
  }

  const check = adapter.checkRemote;
  await mapLimit(items, REMOTE_CONCURRENCY, async (it, i) => {
    let result: RemoteCheckResult;
    try {
      result = check
        ? await check(inputs[i]!)
        : { state: 'unknown', reason: `${forge.type} has no remote check` };
    } catch (error) {
      result = { state: 'unknown', reason: (error as Error).message };
    }
    pushRemoteFinding(it.report, it.parsed, result, options.path);
    bump();
  });
}

const LOCAL_CONCURRENCY = 16;
const REMOTE_CONCURRENCY = 10;

/** Discover, reconcile, and (optionally) network-check an importable tree. */
export async function analyzeImport(
  options: ImportOptions
): Promise<ImportResult> {
  const discovered = await discoverForgemapLayout(options.path);

  const locals = await mapLimit(discovered, LOCAL_CONCURRENCY, (repo) =>
    analyzeLocal(repo, options)
  );
  const reports = locals.map((l) => l.report);
  const derived = deriveConfig(reports, options.path);

  // host-unmatched is offline but needs the derived forge to compare against.
  for (const { report, parsed } of locals) {
    const forge = derived.forges[report.repo.serverDir];
    if (parsed?.host && forge?.host && parsed.host !== forge.host) {
      report.findings.push({
        kind: 'host-unmatched',
        severity: 'warn',
        message: `origin host ${parsed.host} differs from forge host ${forge.host}`
      });
    }
  }

  const checkable: Checkable[] = locals.flatMap((l) =>
    l.report.originUrl && l.parsed
      ? [{ report: l.report, parsed: l.parsed }]
      : []
  );

  if (!options.remoteCheck) {
    for (const { report } of checkable) {
      report.findings.push({
        kind: 'remote-check-skipped',
        severity: 'ok',
        message: 'remote check skipped (--no-remote-check)'
      });
    }
    return { root: options.path, derived, reports };
  }

  const total = checkable.length;
  let done = 0;
  const bump = () => {
    done++;
    options.onProgress?.(done, total);
  };
  options.onProgress?.(0, total);

  // Group by server dir so each forge's repos can be checked in one batch.
  const groups = new Map<string, Checkable[]>();
  for (const item of checkable) {
    const key = item.report.repo.serverDir;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  await Promise.all(
    Array.from(groups, ([serverDir, items]) => {
      const forge = derived.forges[serverDir];
      if (!forge) {
        for (const it of items) {
          it.report.findings.push({
            kind: 'remote-check-unknown',
            severity: 'warn',
            message: 'no forge derived for this server dir'
          });
          bump();
        }
        return Promise.resolve();
      }
      return checkForgeGroup(forge, items, options, bump);
    })
  );

  return { root: options.path, derived, reports };
}
