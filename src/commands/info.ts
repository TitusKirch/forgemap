import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { defineCommand } from 'citty';
import { colors } from 'consola/utils';
import { dirname, join, resolve } from 'pathe';
import { type ConfigSource, loadForgeMapConfig } from '../config/load.ts';
import { resolveRoot } from '../utils/path.ts';

// Injected at build time by vite's `define` (see vite.config.ts), sourced from
// package.json's `version`. Read it the same way `cli.ts` does rather than
// re-inventing a drift-prone literal.
declare const __APP_VERSION__: string;

/** `linked` = runs from a git work tree; `release` = an installed package. */
type BuildKind = 'linked' | 'release' | 'unknown';

interface BuildInfo {
  kind: BuildKind;
  /** Directory of the nearest `forgemap` package.json above the binary. */
  packageRoot: string | null;
  reason: string;
}

interface BinaryInfo {
  /** The path as invoked (may be a shim / symlink). */
  invoked: string | null;
  /** The real executed file, symlinks resolved. */
  resolved: string | null;
}

interface ForgeInfo {
  name: string;
  type: string;
  dir: string;
}

interface ConfigInfo {
  source: ConfigSource | 'error';
  file: string | null;
  root: string | null;
  forges: ForgeInfo[];
  /** Set when the config could not be loaded (missing/broken); else null. */
  error: string | null;
}

interface Info {
  version: string;
  build: BuildInfo;
  binary: BinaryInfo;
  node: string;
  config: ConfigInfo;
}

/** Resolve the real executed file behind any shim or symlink. */
function resolveBinary(entry: string | undefined): BinaryInfo {
  if (!entry) return { invoked: null, resolved: null };
  try {
    return { invoked: entry, resolved: realpathSync(entry) };
  } catch {
    // The file vanished (or is unreadable) — report the invoked path as-is
    // rather than failing; `info` describes, it never judges.
    return { invoked: entry, resolved: entry };
  }
}

/** Walk up from `start` to the nearest package.json, returning its dir + name. */
function findPackageRoot(
  start: string
): { dir: string; name: string | undefined } | null {
  let dir = resolve(start);
  for (;;) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
          name?: string;
        };
        return { dir, name: pkg.name };
      } catch {
        return { dir, name: undefined };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Distinguish a linked/dev build from an installed release: the resolved binary
 * lives inside a git work tree whose package.json is named `forgemap`. An
 * installed package has the same package.json but no `.git` beside it. When the
 * binary or a `forgemap` package.json cannot be located, report `unknown`
 * rather than guessing.
 */
function detectBuild(resolved: string | null): BuildInfo {
  if (!resolved) {
    return {
      kind: 'unknown',
      packageRoot: null,
      reason: 'binary path could not be resolved'
    };
  }
  const pkg = findPackageRoot(dirname(resolved));
  if (!pkg) {
    return {
      kind: 'unknown',
      packageRoot: null,
      reason: 'no package.json found above the binary'
    };
  }
  if (pkg.name !== 'forgemap') {
    return {
      kind: 'unknown',
      packageRoot: pkg.dir,
      reason: `nearest package.json is "${pkg.name ?? 'unnamed'}", not forgemap`
    };
  }
  // Check `.git` only at the forgemap package root, never above it: an installed
  // package under a consumer's node_modules would otherwise inherit that repo's
  // .git and be mislabelled as linked.
  const inGitTree = existsSync(join(pkg.dir, '.git'));
  return {
    kind: inGitTree ? 'linked' : 'release',
    packageRoot: pkg.dir,
    reason: inGitTree
      ? 'runs from a git work tree named forgemap'
      : 'installed forgemap package (no git work tree beside it)'
  };
}

async function gatherConfig(
  configFile: string | undefined
): Promise<ConfigInfo> {
  try {
    const loaded = await loadForgeMapConfig({ configFile });
    const configDir = loaded.configFile
      ? dirname(loaded.configFile)
      : loaded.cwd;
    return {
      source: loaded.source,
      file: loaded.configFile ?? null,
      root: resolveRoot(loaded.config.root, configDir),
      forges: Object.entries(loaded.config.forges).map(([name, forge]) => ({
        name,
        type: forge.type,
        dir: forge.dir
      })),
      error: null
    };
  } catch (error) {
    // A broken config file must not sink the whole command — the config is one
    // section of the output, not a prerequisite for version/paths/node.
    return {
      source: 'error',
      file: null,
      root: null,
      forges: [],
      error: (error as Error).message
    };
  }
}

const SOURCE_LABELS: Record<ConfigSource | 'error', string> = {
  flag: '--config flag',
  env: 'FORGEMAP_CONFIG env',
  'walk-up': 'walk-up from cwd',
  global: 'global ($XDG_CONFIG_HOME/forgemap)',
  default: 'built-in defaults (no config file found)',
  error: 'failed to load'
};

const BUILD_LABELS: Record<BuildKind, string> = {
  linked: 'linked / dev build',
  release: 'installed release',
  unknown: 'unknown'
};

function row(label: string, value: string): string {
  return `  ${colors.dim(label.padEnd(9))} ${value}\n`;
}

function renderPretty(info: Info): string {
  let out = `${colors.bold('forgemap')} ${colors.cyan(`v${info.version}`)} ${colors.dim(`(${BUILD_LABELS[info.build.kind]})`)}\n`;
  out += row('build', colors.dim(info.build.reason));
  out += row('binary', info.binary.resolved ?? colors.dim('unknown'));
  if (info.binary.invoked && info.binary.invoked !== info.binary.resolved) {
    out += row('', colors.dim(`via ${info.binary.invoked}`));
  }
  out += row('node', info.node);

  out += `\n${colors.bold('config')}\n`;
  out += row('source', SOURCE_LABELS[info.config.source]);
  if (info.config.error) {
    out += row('error', colors.red(info.config.error));
  } else {
    out += row('file', info.config.file ?? colors.dim('none'));
    out += row('root', info.config.root ?? colors.dim('unknown'));
  }

  out += `\n${colors.bold('forges')}\n`;
  if (info.config.forges.length === 0) {
    out += `  ${colors.dim('none')}\n`;
  } else {
    for (const forge of info.config.forges) {
      out += `  ${colors.cyan(forge.name.padEnd(12))} ${forge.type} ${colors.dim('→')} ${forge.dir}\n`;
    }
  }
  return out;
}

export const infoCommand = defineCommand({
  meta: {
    name: 'info',
    description:
      'Describe this installation: version, binary path, node, and resolved config'
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
    const binary = resolveBinary(process.argv[1]);
    const info: Info = {
      version: __APP_VERSION__,
      build: detectBuild(binary.resolved),
      binary,
      node: process.version,
      config: await gatherConfig(args.config)
    };

    if (args.json) {
      process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
      return;
    }
    process.stdout.write(renderPretty(info));
  }
});

export const __test = { resolveBinary, findPackageRoot, detectBuild };
