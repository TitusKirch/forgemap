import { access } from 'node:fs/promises';
import { defineCommand } from 'citty';
import consola from 'consola';
import { colors } from 'consola/utils';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import type { ForgeConfig, ForgeMapConfig } from '../config/schema.ts';
import { MAX_SCAN_DEPTH } from '../repos/layout.ts';
import { type ScanHint, scanLayout } from '../repos/scan.ts';
import { resolveRoot } from '../utils/path.ts';
import { execCapture, hasCommand } from '../utils/exec.ts';

type CheckSeverity = 'ok' | 'warn' | 'fail';

interface Check {
  name: string;
  severity: CheckSeverity;
  message: string;
}

const KNOWN_TYPES = new Set(['github', 'gitlab', 'gitea', 'codeberg', 'git']);

function validateForge(name: string, forge: ForgeConfig): Check {
  if (!KNOWN_TYPES.has(forge.type)) {
    return {
      name: `forge "${name}"`,
      severity: 'fail',
      message: `unknown type "${forge.type}"`
    };
  }
  if (!forge.host?.trim()) {
    return {
      name: `forge "${name}"`,
      severity: 'fail',
      message: 'host is empty'
    };
  }
  if (!forge.dir?.trim()) {
    return {
      name: `forge "${name}"`,
      severity: 'fail',
      message: 'dir is empty'
    };
  }
  return {
    name: `forge "${name}"`,
    severity: 'ok',
    message: `${forge.type} at ${forge.host}`
  };
}

async function runChecks(
  config: ForgeMapConfig,
  configDir: string
): Promise<Check[]> {
  const checks: Check[] = [];

  for (const [name, forge] of Object.entries(config.forges)) {
    checks.push(validateForge(name, forge));
  }

  checks.push(
    config.forges[config.defaultForge]
      ? {
          name: 'defaultForge',
          severity: 'ok',
          message: `→ ${config.defaultForge}`
        }
      : {
          name: 'defaultForge',
          severity: 'fail',
          message: `"${config.defaultForge}" is not in forges`
        }
  );

  const root = resolveRoot(config.root, configDir);
  try {
    await access(root);
    checks.push({
      name: 'root directory',
      severity: 'ok',
      message: root
    });
  } catch {
    checks.push({
      name: 'root directory',
      severity: 'fail',
      message: `${root} does not exist (mkdir -p it or fix root in config)`
    });
  }

  const types = new Set(Object.values(config.forges).map((f) => f.type));
  const needsGit = types.has('git') || types.size > 0;
  const needsGh = types.has('github');
  const gitlabForges = Object.entries(config.forges).filter(
    ([, forge]) => forge.type === 'gitlab'
  );

  if (needsGit) {
    checks.push(
      (await hasCommand('git'))
        ? { name: 'git CLI', severity: 'ok', message: 'on PATH' }
        : {
            name: 'git CLI',
            severity: 'fail',
            message: 'install from https://git-scm.com/'
          }
    );
  }

  if (needsGh) {
    if (await hasCommand('gh')) {
      checks.push({ name: 'gh CLI', severity: 'ok', message: 'on PATH' });
      const auth = await execCapture('gh', ['auth', 'status']);
      checks.push(
        auth.code === 0
          ? { name: 'gh auth', severity: 'ok', message: 'authenticated' }
          : {
              name: 'gh auth',
              severity: 'warn',
              message: 'not logged in — run `gh auth login`'
            }
      );
    } else {
      checks.push({
        name: 'gh CLI',
        severity: 'fail',
        message: 'install from https://cli.github.com/'
      });
    }
  }

  // `glab` is required for type: 'gitlab', the way `gh` is for 'github' —
  // there is no silent fallback to plain git, so a missing CLI is a failure.
  if (gitlabForges.length > 0) {
    if (await hasCommand('glab')) {
      checks.push({ name: 'glab CLI', severity: 'ok', message: 'on PATH' });
      for (const [name, forge] of gitlabForges) {
        // Per host, never the user's global `glab config set host`.
        const auth = await execCapture('glab', [
          'auth',
          'status',
          '--hostname',
          forge.host
        ]);
        checks.push(
          auth.code === 0
            ? {
                name: `glab auth (${name})`,
                severity: 'ok',
                message: `authenticated at ${forge.host}`
              }
            : {
                name: `glab auth (${name})`,
                severity: 'warn',
                message: `not logged in — run \`glab auth login --hostname ${forge.host}\``
              }
        );
      }
    } else {
      checks.push({
        name: 'glab CLI',
        severity: 'fail',
        message: 'install from https://gitlab.com/gitlab-org/cli'
      });
    }
  }

  checks.push(await layoutCheck(config, configDir));

  return checks;
}

const HINT_LABEL: Record<ScanHint['reason'], string> = {
  'no-repo': 'holds no git repo',
  'missing-namespace': 'is a repo with no namespace above it',
  'too-deep': `is deeper than ${MAX_SCAN_DEPTH} levels`
};

const HINTS_SHOWN = 5;

/**
 * A repo is a directory holding a `.git` entry, so a branch that never reaches
 * one simply drops out of `list`, `status` and `pick`. That is easy to read as
 * "where did my repo go", which is exactly the question this command exists to
 * answer — so name the branches rather than leaving them silent. A hint, never
 * a failure: an odd layout is not a broken one.
 */
async function layoutCheck(
  config: ForgeMapConfig,
  configDir: string
): Promise<Check> {
  const { repos, hints } = await scanLayout({ config, configDir });
  const count = `${repos.length} repo${repos.length === 1 ? '' : 's'}`;
  if (hints.length === 0) {
    return { name: 'layout', severity: 'ok', message: count };
  }
  const shown = hints
    .slice(0, HINTS_SHOWN)
    .map((hint) => `${hint.path} ${HINT_LABEL[hint.reason]}`);
  const rest =
    hints.length > HINTS_SHOWN ? ` (+${hints.length - HINTS_SHOWN} more)` : '';
  return {
    name: 'layout',
    severity: 'warn',
    message: `${count}; ${shown.join(', ')}${rest}`
  };
}

function severitySymbol(severity: CheckSeverity): string {
  if (severity === 'ok') return colors.green('✓');
  if (severity === 'warn') return colors.yellow('!');
  return colors.red('✗');
}

export const validateCommand = defineCommand({
  meta: {
    name: 'validate',
    description:
      'Preflight: check the config schema, required CLI tools, and root directory'
  },
  args: {
    json: {
      type: 'boolean',
      description: 'Emit a machine-readable JSON report',
      default: false
    },
    config: {
      type: 'string',
      description: 'Path to forgemap.config.ts (overrides walk-up discovery)'
    }
  },
  async run({ args }) {
    const loaded = await loadForgeMapConfig({ configFile: args.config });
    const configDir = loaded.configFile
      ? dirname(loaded.configFile)
      : loaded.cwd;
    const checks = await runChecks(loaded.config, configDir);
    const ok = checks.every((c) => c.severity !== 'fail');

    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ok, checks }, null, 2)}\n`);
    } else {
      for (const c of checks) {
        process.stdout.write(
          `${severitySymbol(c.severity)} ${c.name.padEnd(22)} ${colors.dim(c.message)}\n`
        );
      }
      process.stdout.write(
        `\n${ok ? colors.green('All checks passed.') : colors.red('Validation failed.')}\n`
      );
    }

    if (!ok) {
      process.exitCode = 1;
      return;
    }
    if (!loaded.configFile) {
      consola.warn(
        'No forgemap.config.ts found — using built-in defaults. Run `forgemap config init` to materialize one.'
      );
    }
  }
});
