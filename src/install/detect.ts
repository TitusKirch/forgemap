import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync
} from 'node:fs';
import { dirname, join, normalize, resolve } from 'pathe';

/** The npm package this CLI ships as — the `self-update` target. */
export const PACKAGE_NAME = 'forgemap';

/** `linked` = runs from a git work tree; `release` = an installed package. */
export type BuildKind = 'linked' | 'release' | 'unknown';

export interface BuildInfo {
  kind: BuildKind;
  /** Directory of the nearest `forgemap` package.json above the binary. */
  packageRoot: string | null;
  reason: string;
}

export interface BinaryInfo {
  /** The path as invoked (may be a shim / symlink). */
  invoked: string | null;
  /** The real executed file, symlinks resolved. */
  resolved: string | null;
}

/** Resolve the real executed file behind any shim or symlink. */
export function resolveBinary(entry: string | undefined): BinaryInfo {
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
export function findPackageRoot(
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
export function detectBuild(resolved: string | null): BuildInfo {
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
  if (pkg.name !== PACKAGE_NAME) {
    return {
      kind: 'unknown',
      packageRoot: pkg.dir,
      reason: `nearest package.json is "${pkg.name ?? 'unnamed'}", not ${PACKAGE_NAME}`
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
      ? `runs from a git work tree named ${PACKAGE_NAME}`
      : `installed ${PACKAGE_NAME} package (no git work tree beside it)`
  };
}

/**
 * Who owns this install. The package manager that put forgemap on the machine
 * owns updating it too — `self-update` only ever proposes its command — so the
 * two states {@link BuildKind} draws (installed vs. dev build) are not enough:
 * `npm i -g` and `pnpm add -g` are different commands, and an npx cache or a
 * project dependency must never be handed either one.
 */
export type InstallKind =
  | 'npm-global'
  | 'pnpm-global'
  | 'bun-global'
  | 'yarn-global'
  | 'volta'
  | 'ephemeral'
  | 'project'
  | 'linked'
  | 'unknown';

export interface UpdateCommand {
  bin: string;
  args: string[];
}

export interface InstallInfo {
  kind: InstallKind;
  /** Directory of the nearest `forgemap` package.json above the binary. */
  packageRoot: string | null;
  reason: string;
  /** The command that updates this install, or null when none may be run. */
  command: UpdateCommand | null;
  /** Whether the directory an installer rewrites is writable by this user. */
  writable: boolean;
}

/**
 * The update command per owner. Deliberately never `sudo`-prefixed: a command
 * the user confirms blind must not escalate — an unwritable target is reported
 * as a blocker instead (see {@link updateBlocker}).
 */
const COMMANDS: Partial<Record<InstallKind, UpdateCommand>> = {
  'npm-global': {
    bin: 'npm',
    args: ['install', '-g', `${PACKAGE_NAME}@latest`]
  },
  'pnpm-global': { bin: 'pnpm', args: ['add', '-g', `${PACKAGE_NAME}@latest`] },
  'bun-global': { bin: 'bun', args: ['add', '-g', `${PACKAGE_NAME}@latest`] },
  'yarn-global': {
    bin: 'yarn',
    args: ['global', 'add', `${PACKAGE_NAME}@latest`]
  },
  volta: { bin: 'volta', args: ['install', `${PACKAGE_NAME}@latest`] }
};

const REASONS: Record<InstallKind, string> = {
  'npm-global': "npm's global node_modules",
  'pnpm-global': "pnpm's global store",
  'bun-global': "bun's global install directory",
  'yarn-global': "yarn's global node_modules",
  volta: "volta's package image",
  ephemeral: 'a one-off npx/dlx cache, discarded after the run',
  project: "a project's node_modules, owned by its package.json",
  linked: `runs from a git work tree named ${PACKAGE_NAME}`,
  unknown: 'an install layout this version does not recognise'
};

/**
 * pnpm's global generation directory: `$PNPM_HOME/global/5` up to pnpm 10,
 * `$PNPM_HOME/global/v11/<hash>` since pnpm 11. Conclusive proof of a global
 * install in either path.
 */
const PNPM_GLOBAL = /\/global\/v?\d+\//;

/**
 * pnpm's virtual store, `…/store/v11/links/…`. Since pnpm 11 a *project's*
 * dependency resolves in there too, so this pattern says only "pnpm put it
 * here" and nothing about global vs. project — which is why it can only ever
 * push the answer down to `unknown`, never up to a kind that carries a command.
 */
const PNPM_STORE = /\/store\/v?\d+\/links\//;

export interface ClassifyOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Write-access probe; injected by tests, else a real `access(W_OK)`. */
  isWritable?: (dir: string) => boolean;
}

function probeWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** True when `path` contains `segment` as a whole path segment. */
function hasSegment(path: string, segment: string): boolean {
  return `${path}/`.includes(`/${segment}/`);
}

/** True when `path` is `prefix` or sits below it. */
function under(path: string | null, prefix: string | undefined): boolean {
  if (!path || !prefix) return false;
  const base = normalize(resolve(prefix));
  return path === base || path.startsWith(`${base}/`);
}

/** A copy unpacked for a single `npx` / `dlx` / `bunx` run. */
function isEphemeral(path: string): boolean {
  return (
    hasSegment(path, '_npx') ||
    hasSegment(path, 'dlx') ||
    path.includes('/install/cache/')
  );
}

/**
 * Classify by the shape of the paths a run actually has: `argv[1]` as invoked
 * (a manager's shim, which is what names the manager) and the package root the
 * binary really lives in (which names the layout). Both are needed — pnpm's
 * shim is the only thing that separates its global install from a project
 * dependency, while npm's signal sits in the resolved root alone.
 *
 * These layouts are each manager's own convention rather than a documented API,
 * so anything that matches nothing lands on `unknown` — which blocks the run —
 * instead of being handed to a guessed installer.
 */
function classifyPaths(
  invoked: string | null,
  packageRoot: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): InstallKind {
  const paths = invoked ? [invoked, packageRoot] : [packageRoot];

  // Ephemeral caches go first: an npx/dlx copy sits *inside* a manager's home,
  // so every check below would match it, and updating a directory the next run
  // throws away does nothing.
  if (paths.some(isEphemeral)) return 'ephemeral';
  if (paths.some((p) => under(p, env.VOLTA_HOME) || hasSegment(p, '.volta'))) {
    return 'volta';
  }
  if (
    paths.some(
      (p) => under(p, env.BUN_INSTALL) || p.includes('/.bun/install/global/')
    )
  ) {
    return 'bun-global';
  }
  // Only the *invoked* path may place pnpm by `$PNPM_HOME`: since pnpm 11 the
  // store under that same home is shared with every project on the machine, so
  // the package root being in there proves nothing about this install.
  if (under(invoked, env.PNPM_HOME) || paths.some((p) => PNPM_GLOBAL.test(p))) {
    return 'pnpm-global';
  }
  if (paths.some((p) => hasSegment(p, 'yarn') && hasSegment(p, 'global'))) {
    return 'yarn-global';
  }
  // npm's global prefix is `<prefix>/lib/node_modules` everywhere but Windows,
  // where it is `<prefix>/npm/node_modules`. The `lib` segment is also what
  // separates a global install from a project dependency below.
  if (
    packageRoot.includes('/lib/node_modules/') ||
    paths.some((p) => under(p, env.npm_config_prefix)) ||
    (platform === 'win32' && packageRoot.includes('/npm/node_modules/'))
  ) {
    return 'npm-global';
  }
  // A pnpm store path nothing above could place is either a global install
  // whose store sits outside `$PNPM_HOME` or a project dependency — the store
  // cannot tell them apart. Say that, rather than name the wrong one: `unknown`
  // prints the command and runs nothing.
  if (PNPM_STORE.test(packageRoot)) return 'unknown';
  if (hasSegment(packageRoot, 'node_modules')) return 'project';
  return 'unknown';
}

/** Describe the install behind `binary`, and what would update it. */
export function classifyInstall(
  binary: BinaryInfo,
  options: ClassifyOptions = {}
): InstallInfo {
  const build = detectBuild(binary.resolved);
  if (build.kind !== 'release' || !build.packageRoot) {
    // A dev build keeps its own kind; `unknown` means no forgemap package root
    // was found at all, so there is nothing to classify. Both carry
    // detectBuild's more specific reason rather than the generic one.
    return {
      kind: build.kind === 'linked' ? 'linked' : 'unknown',
      packageRoot: build.packageRoot,
      reason: build.reason,
      command: null,
      writable: false
    };
  }

  const kind = classifyPaths(
    binary.invoked ? normalize(binary.invoked) : null,
    normalize(build.packageRoot),
    options.env ?? process.env,
    options.platform ?? process.platform
  );
  const command = COMMANDS[kind] ?? null;
  return {
    kind,
    packageRoot: build.packageRoot,
    reason: REASONS[kind],
    command,
    // The installer replaces the package directory, so the `node_modules` above
    // it is what has to be writable — not the package directory itself.
    writable: command
      ? (options.isWritable ?? probeWritable)(dirname(build.packageRoot))
      : false
  };
}

/**
 * Why `self-update` must not run the command itself, or null when it may. Every
 * case here is one where running an installer would either fight whoever owns
 * the install or need rights this process does not have.
 */
export function updateBlocker(install: InstallInfo): string | null {
  switch (install.kind) {
    case 'linked':
      return 'this is a linked dev build — update it with git, not a package manager';
    case 'ephemeral':
      return 'this copy lives in a one-off npx/dlx cache that is discarded after the run — install forgemap globally instead';
    case 'project':
      return "this copy is a project dependency — bump it in that project's package.json";
    case 'unknown':
      return 'the install layout was not recognised, so there is no command that is safe to run';
    default:
      break;
  }
  if (!install.command) return 'no update command is known for this install';
  if (!install.writable) {
    const dir = install.packageRoot
      ? dirname(install.packageRoot)
      : 'the install directory';
    return `${dir} is not writable by this user — run the command yourself with the rights it needs`;
  }
  return null;
}

/** Render an {@link UpdateCommand} as the line a user would type. */
export function formatCommand(command: UpdateCommand): string {
  return [command.bin, ...command.args].join(' ');
}
