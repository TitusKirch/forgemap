import { access } from 'node:fs/promises';
import { defineCommand } from 'citty';
import consola from 'consola';
import { colors } from 'consola/utils';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import type { ForgeConfig, ForgeMapConfig } from '../config/schema.ts';
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

  return checks;
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
