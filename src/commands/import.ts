import { existsSync } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { defineCommand } from 'citty';
import consola from 'consola';
import { colors, formatTree } from 'consola/utils';
import { dirname, join, resolve } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import type { ForgeConfig, ForgeMapConfig } from '../config/schema.ts';
import { writeConfigFile } from '../config/write.ts';
import { scanReposCached } from '../repos/cache.ts';
import { setOriginUrl } from '../repos/git.ts';
import {
  analyzeImport,
  type Finding,
  type FindingSeverity,
  type Fix,
  type ImportType,
  type RepoReport
} from '../repos/import.ts';

const ALLOWED_TYPES: ImportType[] = ['forgemap'];
const ALLOWED_FORMATS = ['pretty', 'json'];

function isImportType(value: string): value is ImportType {
  return (ALLOWED_TYPES as string[]).includes(value);
}

function severitySymbol(severity: FindingSeverity): string {
  if (severity === 'fail') return colors.red('✗');
  if (severity === 'warn') return colors.yellow('!');
  return colors.green('✓');
}

function worstSeverity(findings: Finding[]): FindingSeverity {
  if (findings.some((f) => f.severity === 'fail')) return 'fail';
  if (findings.some((f) => f.severity === 'warn')) return 'warn';
  return 'ok';
}

function hasIssues(report: RepoReport): boolean {
  return report.findings.some((f) => f.severity !== 'ok');
}

function repoLine(report: RepoReport): string {
  const slug = `${report.repo.owner}/${report.repo.repo}`;
  const symbol = severitySymbol(worstSeverity(report.findings));
  const issues = report.findings.filter((f) => f.severity !== 'ok');
  if (issues.length === 0) return `${symbol} ${colors.cyan(slug)}`;
  const summary = issues.map((f) => f.message).join('; ');
  return `${symbol} ${colors.cyan(slug)}  ${colors.dim(summary)}`;
}

function renderReports(reports: RepoReport[]): string {
  const groups = new Map<string, RepoReport[]>();
  for (const report of reports) {
    const list = groups.get(report.repo.serverDir);
    if (list) list.push(report);
    else groups.set(report.repo.serverDir, [report]);
  }
  return formatTree(
    Array.from(groups, ([serverDir, items]) => ({
      text: colors.bold(serverDir),
      children: items.map((report) => ({ text: repoLine(report) }))
    }))
  );
}

function renderDerived(config: ForgeMapConfig): string {
  return formatTree([
    {
      text: colors.bold('Derived config'),
      children: Object.entries(config.forges).map(([name, forge]) => ({
        text: `${colors.cyan(name)}  ${colors.dim(
          `${forge.type} @ ${forge.host || '(unknown host)'} → ${forge.dir}`
        )}`
      }))
    }
  ]);
}

async function applyFixes(reports: RepoReport[]): Promise<Fix[]> {
  const applied: Fix[] = [];
  const fixes = reports.flatMap((r) =>
    r.findings.flatMap((f) => (f.fix ? [f.fix] : []))
  );

  // Repoint URLs first so a repo's git config is corrected before it moves.
  for (const fix of fixes) {
    if (fix.action !== 'set-origin-url') continue;
    const result = await setOriginUrl(fix.localPath, fix.url);
    if (result.code === 0) {
      applied.push(fix);
      consola.success(`origin → ${fix.url}`);
    } else {
      consola.warn(
        `failed to set origin for ${fix.localPath}: ${result.stderr.trim()}`
      );
    }
  }

  for (const fix of fixes) {
    if (fix.action !== 'move-folder') continue;
    if (existsSync(fix.to)) {
      consola.warn(`skip move: target exists ${fix.to}`);
      continue;
    }
    await mkdir(dirname(fix.to), { recursive: true });
    await rename(fix.from, fix.to);
    applied.push(fix);
    consola.success(`moved ${fix.from} → ${fix.to}`);
  }

  return applied;
}

/** Merge derived forges into an existing config without clobbering existing
 *  keys. Returns the merged config plus any conflicting keys. */
function augmentConfig(
  existing: ForgeMapConfig,
  derived: ForgeMapConfig
): { merged: ForgeMapConfig; conflicts: string[] } {
  const forges: Record<string, ForgeConfig> = { ...existing.forges };
  const conflicts: string[] = [];
  for (const [name, forge] of Object.entries(derived.forges)) {
    const current = existing.forges[name];
    if (!current) {
      forges[name] = forge;
    } else if (current.host !== forge.host) {
      conflicts.push(name);
    }
  }
  return { merged: { ...existing, forges }, conflicts };
}

export const importCommand = defineCommand({
  meta: {
    name: 'import',
    description:
      'Adopt an existing repo tree: reconcile folders against git remotes and derive a config'
  },
  args: {
    path: {
      type: 'positional',
      description: 'Directory laid out as <server>/<owner>/<repo>',
      required: true
    },
    type: {
      type: 'string',
      description: 'Layout type (currently only "forgemap")',
      default: 'forgemap'
    },
    format: {
      type: 'string',
      description: 'Output format: pretty (default) or json',
      default: 'pretty'
    },
    'remote-check': {
      type: 'boolean',
      description: 'Check each remote for existence/moves (default true)',
      default: true
    },
    fix: {
      type: 'boolean',
      description: 'Apply corrections (move folders, repoint origin URLs)',
      default: false
    },
    'write-config': {
      type: 'boolean',
      description:
        'Write/augment forgemap.config.ts from the derived structure',
      default: true
    },
    out: {
      type: 'string',
      description:
        'Directory to write the derived config into (defaults to <path>)'
    },
    force: {
      type: 'boolean',
      description: 'Overwrite an existing config instead of augmenting it',
      default: false
    }
  },
  async run({ args }) {
    if (!isImportType(args.type)) {
      consola.error(
        `Invalid --type value "${args.type}". Allowed: ${ALLOWED_TYPES.join(', ')}.`
      );
      process.exitCode = 1;
      return;
    }
    if (!ALLOWED_FORMATS.includes(args.format)) {
      consola.error(
        `Invalid --format value "${args.format}". Allowed: ${ALLOWED_FORMATS.join(', ')}.`
      );
      process.exitCode = 1;
      return;
    }

    const path = resolve(process.cwd(), args.path);
    try {
      const s = await stat(path);
      if (!s.isDirectory()) {
        consola.error(`${path} is not a directory.`);
        process.exitCode = 1;
        return;
      }
    } catch {
      consola.error(`${path} does not exist.`);
      process.exitCode = 1;
      return;
    }

    // Progress for the (potentially slow) remote checks. stderr-only and
    // TTY-guarded so it never corrupts JSON on stdout or piped logs.
    const showProgress = args['remote-check'] && Boolean(process.stderr.isTTY);
    let clearLen = 0;
    const onProgress = showProgress
      ? (done: number, total: number) => {
          const msg = `⏳ Checking remotes ${done}/${total}`;
          process.stderr.write(`\r${msg} `);
          clearLen = msg.length + 1;
        }
      : undefined;

    const result = await analyzeImport({
      path,
      type: args.type,
      remoteCheck: args['remote-check'],
      onProgress
    });

    if (clearLen > 0) {
      process.stderr.write(`\r${' '.repeat(clearLen)}\r`);
    }

    const applied = args.fix ? await applyFixes(result.reports) : [];

    const withFindings = result.reports.filter(hasIssues).length;
    const fixable = result.reports.reduce(
      (n, r) => n + r.findings.filter((f) => f.fix).length,
      0
    );

    if (args.format === 'json') {
      process.stdout.write(
        `${JSON.stringify(
          {
            path,
            type: args.type,
            derived: result.derived,
            repos: result.reports.map((r) => ({
              serverDir: r.repo.serverDir,
              owner: r.repo.owner,
              repo: r.repo.repo,
              localPath: r.repo.localPath,
              originUrl: r.originUrl,
              remotes: r.remotes,
              findings: r.findings
            })),
            ...(args.fix ? { applied } : {}),
            summary: { repos: result.reports.length, withFindings, fixable }
          },
          null,
          2
        )}\n`
      );
    } else {
      process.stdout.write(
        `${colors.dim(`Scanned ${path} (${args.type})`)}\n\n`
      );
      if (result.reports.length === 0) {
        consola.info('No repos found.');
      } else {
        process.stdout.write(`${renderReports(result.reports)}\n\n`);
      }
      process.stdout.write(`${renderDerived(result.derived)}\n\n`);
      process.stdout.write(
        `${colors.bold(`${result.reports.length} repos`)}, ${withFindings} with findings, ${fixable} fixable${
          args.fix ? `, ${applied.length} fixed` : ''
        }\n`
      );
    }

    if (!args['write-config']) return;
    if (result.reports.length === 0 && !args.force) return;

    const outDir = args.out ? resolve(process.cwd(), args.out) : path;
    const writableRoot = outDir === path ? '.' : path;
    const target = join(outDir, 'forgemap.config.ts');

    if (existsSync(target) && !args.force) {
      const loaded = await loadForgeMapConfig({ configFile: target });
      const { merged, conflicts } = augmentConfig(
        loaded.config,
        result.derived
      );
      for (const name of conflicts) {
        consola.warn(
          `forge "${name}" already exists with a different host — left untouched`
        );
      }
      await writeConfigFile(merged, { outDir, force: true });
      consola.success(`Augmented ${target}`);
    } else {
      const written = await writeConfigFile(
        { ...result.derived, root: writableRoot },
        { outDir, force: args.force }
      );
      if (written) consola.success(`Wrote ${written.path}`);
    }

    // Warm the scan cache so the next status/search hits the hot path.
    await scanReposCached({
      config: result.derived,
      configDir: path,
      useCache: false
    });
  }
});
