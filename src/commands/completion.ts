import { defineCommand } from 'citty';
import consola from 'consola';
import {
  type Shell,
  SUPPORTED_SHELLS as SUPPORTED,
  detectShell,
  installRcBlock
} from '../utils/shell.ts';

const SUBCOMMANDS = [
  'clone',
  'import',
  'cleanup',
  'delete',
  'cd',
  'path',
  'open',
  'search',
  'pick',
  'status',
  'sync',
  'validate',
  'shell-init',
  'completion',
  'config'
];

const SLUG_COMMANDS = [
  'clone',
  'cd',
  'path',
  'open',
  'search',
  'pick',
  'delete'
];

function renderBash(): string {
  return `# forgemap bash completion — drop into your ~/.bashrc:
#   eval "$(forgemap completion bash)"
_forgemap_completion() {
  local cur prev cmd words
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmd="\${COMP_WORDS[1]}"

  if [ "$COMP_CWORD" = "1" ]; then
    COMPREPLY=( $(compgen -W "${SUBCOMMANDS.join(' ')}" -- "$cur") )
    return
  fi

  case "$cmd" in
    ${SLUG_COMMANDS.join('|')})
      local slugs
      slugs=$(forgemap search '' --format slug 2>/dev/null)
      COMPREPLY=( $(compgen -W "$slugs" -- "$cur") )
      ;;
  esac
}
complete -F _forgemap_completion forgemap
`;
}

function renderZsh(): string {
  return `# forgemap zsh completion — drop into your ~/.zshrc:
#   eval "$(forgemap completion zsh)"
_forgemap() {
  local context state line
  local -a subcommands slug_cmds
  subcommands=(${SUBCOMMANDS.map((s) => `'${s}'`).join(' ')})
  slug_cmds=(${SLUG_COMMANDS.map((s) => `'${s}'`).join(' ')})

  _arguments -C \\
    '1: :->cmd' \\
    '*::arg:->args'

  case "$state" in
    cmd) _describe 'forgemap subcommand' subcommands ;;
    args)
      if (( $slug_cmds[(I)$words[1]] )); then
        local -a slugs
        slugs=("\${(@f)$(forgemap search '' --format slug 2>/dev/null)}")
        _describe 'slug' slugs
      fi
      ;;
  esac
}
compdef _forgemap forgemap
`;
}

function renderFish(): string {
  const slugCmdsList = SLUG_COMMANDS.map((s) => `"${s}"`).join(' ');
  return `# forgemap fish completion — drop into your ~/.config/fish/config.fish:
#   forgemap completion fish | source

# Subcommands (depth 1).
complete -c forgemap -f -n '__fish_use_subcommand' -a '${SUBCOMMANDS.join(' ')}'

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
  -a '(forgemap search "" --format slug 2>/dev/null)'
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

    const out =
      requested === 'fish'
        ? renderFish()
        : requested === 'zsh'
          ? renderZsh()
          : renderBash();
    process.stdout.write(out);
  }
});
