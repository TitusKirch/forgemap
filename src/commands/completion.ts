import { type ArgsDef, type CommandDef, defineCommand } from 'citty';
import consola from 'consola';
import {
  type Shell,
  SUPPORTED_SHELLS as SUPPORTED,
  detectShell,
  installRcBlock
} from '../utils/shell.ts';
import { cdCommand } from './cd.ts';
import { cleanupCommand } from './cleanup.ts';
import { cloneCommand } from './clone.ts';
import { configCommand } from './config/index.ts';
import { deleteCommand } from './delete.ts';
import { importCommand } from './import.ts';
import { infoCommand } from './info.ts';
import { listCommand } from './list.ts';
import { openCommand } from './open.ts';
import { pathCommand } from './path.ts';
import { pickCommand } from './pick.ts';
import { shellInitCommand } from './shell-init.ts';
import { statusCommand } from './status.ts';
import { syncCommand } from './sync.ts';
import { validateCommand } from './validate.ts';

// Commands whose depth-2 positional is a repo slug: these complete against the
// live `forgemap list --format slug` output (the one dynamic value source).
const SLUG_COMMANDS = ['clone', 'cd', 'path', 'open', 'list', 'pick', 'delete'];

// Fixed value sets a command validates internally. citty's arg metadata carries
// no enum options for these — they are declared `type: 'string'` and checked in
// each command's `run()` — so the value lists are curated here, keyed by
// subcommand then flag, sitting next to the flags they annotate. Flag *names*
// are derived from the definitions below and need no upkeep; only these static
// value sets do.
const STATIC_FLAG_VALUES: Record<string, Record<string, string[]>> = {
  list: { '--format': ['auto', 'pretty', 'path', 'slug'] },
  status: { '--format': ['pretty', 'json'] },
  import: { '--format': ['pretty', 'json'], '--type': ['forgemap'] }
};

// Commands whose leading positional is a shell flavor (completed statically
// from the supported-shells list rather than hardcoded here).
const SHELL_POSITIONAL = new Set(['completion', 'shell-init']);

// Commands in the registry have heterogeneous arg shapes; `CommandDef<any>` is
// how citty itself types such collections (see its `SubCommandsDef`).
type AnyCommand = CommandDef<any>;

interface CommandSpec {
  name: string;
  /** Flag names (`--foo`, plus `--no-foo` for negatable booleans). */
  flags: string[];
  /** Static value sets for flags that take a fixed enum (e.g. `--format`). */
  flagValues: Record<string, string[]>;
  /** Static values for the leading positional (shell flavors), if any. */
  positionalValues: string[];
  /** Whether the leading positional completes against repo slugs. */
  slugs: boolean;
}

/** Every forgemap command declares `args` as a plain object literal (or omits
 *  it, like `config`), never a thunk — so no `Resolvable` unwrapping is needed. */
function argsOf(cmd: AnyCommand): ArgsDef {
  return (cmd.args ?? {}) as ArgsDef;
}

/** Flag names a command exposes, derived from its `defineCommand` args so a new
 *  flag surfaces in completion automatically. Positionals are handled
 *  separately; negatable booleans (those with a `negativeDescription`) also get
 *  their `--no-<flag>` form. */
function flagsOf(cmd: AnyCommand): string[] {
  const flags: string[] = [];
  for (const [name, def] of Object.entries(argsOf(cmd))) {
    if (def.type === 'positional') continue;
    flags.push(`--${name}`);
    if (def.type === 'boolean' && def.negativeDescription) {
      flags.push(`--no-${name}`);
    }
  }
  return flags;
}

/** The ordered subcommand registry, mirroring `rootCommand.subCommands` in
 *  cli.ts. It is kept here rather than imported from cli.ts because that would
 *  form a cycle (cli → completion → cli). Built lazily so the self-reference to
 *  `completionCommand` resolves after the module finishes initializing. */
function commandSpecs(): CommandSpec[] {
  const registry: Array<readonly [string, AnyCommand]> = [
    ['clone', cloneCommand],
    ['import', importCommand],
    ['cleanup', cleanupCommand],
    ['delete', deleteCommand],
    ['cd', cdCommand],
    ['path', pathCommand],
    ['open', openCommand],
    ['list', listCommand],
    ['pick', pickCommand],
    ['status', statusCommand],
    ['sync', syncCommand],
    ['validate', validateCommand],
    ['info', infoCommand],
    ['completion', completionCommand],
    ['shell-init', shellInitCommand],
    ['config', configCommand]
  ];
  return registry.map(([name, cmd]) => ({
    name,
    flags: flagsOf(cmd),
    flagValues: STATIC_FLAG_VALUES[name] ?? {},
    positionalValues: SHELL_POSITIONAL.has(name) ? [...SUPPORTED] : [],
    slugs: SLUG_COMMANDS.includes(name)
  }));
}

function flagValuePairs(
  specs: CommandSpec[]
): Array<[string, string, string[]]> {
  return specs.flatMap((s) =>
    Object.entries(s.flagValues).map(
      ([flag, values]) => [s.name, flag, values] as [string, string, string[]]
    )
  );
}

function renderBash(specs: CommandSpec[]): string {
  const names = specs.map((s) => s.name).join(' ');

  const valueArms = flagValuePairs(specs)
    .map(
      ([cmd, flag, values]) =>
        `    ${cmd}:${flag}) COMPREPLY=( $(compgen -W "${values.join(' ')}" -- "$cur") ); return ;;`
    )
    .join('\n');

  const flagArms = specs
    .filter((s) => s.flags.length > 0)
    .map((s) => `    ${s.name}) flags="${s.flags.join(' ')}" ;;`)
    .join('\n');

  const slugCmds = specs.filter((s) => s.slugs).map((s) => s.name);
  const positionalArms = [
    slugCmds.length > 0
      ? `    ${slugCmds.join('|')})
      local slugs
      slugs=$(forgemap list --format slug 2>/dev/null)
      COMPREPLY=( $(compgen -W "$slugs" -- "$cur") )
      ;;`
      : '',
    ...specs
      .filter((s) => s.positionalValues.length > 0)
      .map(
        (s) =>
          `    ${s.name}) COMPREPLY=( $(compgen -W "${s.positionalValues.join(' ')}" -- "$cur") ) ;;`
      )
  ]
    .filter(Boolean)
    .join('\n');

  return `# forgemap bash completion — drop into your ~/.bashrc:
#   eval "$(forgemap completion bash)"
_forgemap_completion() {
  local cur prev cmd flags
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmd="\${COMP_WORDS[1]}"

  if [ "$COMP_CWORD" = "1" ]; then
    COMPREPLY=( $(compgen -W "${names}" -- "$cur") )
    return
  fi

  # Values for flags with a fixed set (e.g. --format), keyed by "<cmd>:<flag>".
  case "$cmd:$prev" in
${valueArms}
  esac

  # Flag names for the current subcommand.
  if [[ "$cur" == -* ]]; then
    case "$cmd" in
${flagArms}
    esac
    COMPREPLY=( $(compgen -W "$flags" -- "$cur") )
    return
  fi

  # Positional values (repo slugs, or a shell name).
  case "$cmd" in
${positionalArms}
  esac
}
complete -F _forgemap_completion forgemap
`;
}

function renderZsh(specs: CommandSpec[]): string {
  const subcommands = specs.map((s) => `'${s.name}'`).join(' ');

  const valueArms = flagValuePairs(specs)
    .map(
      ([cmd, flag, values]) =>
        `    ${cmd}:${flag}) compadd ${values.join(' ')}; return ;;`
    )
    .join('\n');

  const flagArms = specs
    .filter((s) => s.flags.length > 0)
    .map((s) => `    ${s.name}) compadd -- ${s.flags.join(' ')}; return ;;`)
    .join('\n');

  const slugCmds = specs
    .filter((s) => s.slugs)
    .map((s) => s.name)
    .join('|');
  const shellArms = specs
    .filter((s) => s.positionalValues.length > 0)
    .map((s) => `    ${s.name}) compadd ${s.positionalValues.join(' ')} ;;`)
    .join('\n');

  return `# forgemap zsh completion — drop into your ~/.zshrc:
#   eval "$(forgemap completion zsh)"
_forgemap() {
  local -a subcommands
  subcommands=(${subcommands})
  local cmd="\${words[2]}"
  local prev="\${words[CURRENT-1]}"
  local cur="\${words[CURRENT]}"

  if (( CURRENT == 2 )); then
    _describe 'forgemap subcommand' subcommands
    return
  fi

  # Values for flags with a fixed set (e.g. --format), keyed by "<cmd>:<flag>".
  case "$cmd:$prev" in
${valueArms}
  esac

  # Flag names for the current subcommand.
  if [[ "$cur" == -* ]]; then
    case "$cmd" in
${flagArms}
    esac
    return
  fi

  # Positional values (repo slugs, or a shell name).
  case "$cmd" in
    ${slugCmds})
      local -a slugs
      slugs=("\${(@f)$(forgemap list --format slug 2>/dev/null)}")
      _describe 'slug' slugs
      ;;
${shellArms}
  esac
}
compdef _forgemap forgemap
`;
}

function renderFish(specs: CommandSpec[]): string {
  const names = specs.map((s) => s.name).join(' ');

  const flagLines = specs
    .flatMap((s) =>
      s.flags.map((flag) => {
        const long = flag.replace(/^--/, '');
        const values = s.flagValues[flag];
        const valuePart = values ? ` -x -a '${values.join(' ')}'` : '';
        return `complete -c forgemap -n '__fish_seen_subcommand_from ${s.name}' -l ${long}${valuePart}`;
      })
    )
    .join('\n');

  const shellCmds = specs.filter((s) => s.positionalValues.length > 0);
  const shellCmdsList = shellCmds.map((s) => `"${s.name}"`).join(' ');
  // Both shell-positional commands share the supported-shells value set.
  const shellValues = shellCmds[0]?.positionalValues.join(' ') ?? '';

  const slugCmdsList = specs
    .filter((s) => s.slugs)
    .map((s) => `"${s.name}"`)
    .join(' ');

  return `# forgemap fish completion — drop into your ~/.config/fish/config.fish:
#   forgemap completion fish | source

# Subcommands (depth 1).
complete -c forgemap -f -n '__fish_use_subcommand' -a '${names}'

# Flags per subcommand (with fixed value sets where applicable).
${flagLines}

# Shell flavor for completion / shell-init (depth 2).
function __forgemap_needs_shell
  set -l tokens (commandline -opc)
  set -l shell_cmds ${shellCmdsList}
  if test (count $tokens) -ge 2; and contains $tokens[2] $shell_cmds
    return 0
  end
  return 1
end
complete -c forgemap -f -n '__forgemap_needs_shell' -a '${shellValues}'

# Slugs (depth 2) for commands that take one.
function __forgemap_needs_slug
  set -l tokens (commandline -opc)
  set -l slug_cmds ${slugCmdsList}
  if test (count $tokens) -ge 2; and contains $tokens[2] $slug_cmds
    return 0
  end
  return 1
end

complete -c forgemap -f -n '__forgemap_needs_slug' \\
  -a '(forgemap list --format slug 2>/dev/null)'
`;
}

export const completionCommand = defineCommand({
  meta: {
    name: 'completion',
    description:
      'Print a shell completion script. Source via `eval "$(forgemap completion)"`.'
  },
  args: {
    shell: {
      type: 'positional',
      description: `Shell flavor (${SUPPORTED.join(', ')}). Auto-detected from $SHELL if omitted.`,
      required: false
    },
    install: {
      type: 'boolean',
      description:
        "Append the completion loader to your shell's rc file (idempotent) instead of printing",
      default: false
    }
  },
  async run({ args }) {
    const requested = (args.shell ?? detectShell()) as Shell;
    if (!SUPPORTED.includes(requested)) {
      consola.error(
        `Unsupported shell "${requested}". Supported: ${SUPPORTED.join(', ')}.`
      );
      process.exitCode = 1;
      return;
    }

    if (args.install) {
      const loader =
        requested === 'fish'
          ? 'forgemap completion fish | source'
          : `eval "$(forgemap completion ${requested})"`;
      const { status, rcFile } = await installRcBlock(requested, 'completion', [
        loader
      ]);
      if (status === 'present') {
        consola.info(`forgemap completion already present in ${rcFile}.`);
      } else {
        const verb = status === 'updated' ? 'Updated' : 'Added';
        consola.success(`${verb} forgemap completion in ${rcFile}.`);
        consola.info(
          `Run \`source ${rcFile}\` or restart your shell to activate it.`
        );
      }
      return;
    }

    const specs = commandSpecs();
    const out =
      requested === 'fish'
        ? renderFish(specs)
        : requested === 'zsh'
          ? renderZsh(specs)
          : renderBash(specs);
    process.stdout.write(out);
  }
});
