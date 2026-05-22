import { defineCommand } from 'citty';
import consola from 'consola';

type Shell = 'zsh' | 'bash' | 'fish';

const SUPPORTED: Shell[] = ['zsh', 'bash', 'fish'];

function detectShell(): Shell {
  const env = process.env.SHELL ?? '';
  if (env.endsWith('/fish')) return 'fish';
  if (env.endsWith('/bash')) return 'bash';
  return 'zsh';
}

function renderPosix(fnName: string): string {
  return `# forgemap shell integration — drop into your ~/.zshrc / ~/.bashrc:
#   eval "$(forgemap shell-init)"

${fnName}() {
  if [ "$#" -eq 0 ]; then
    local target
    target=$(forgemap pick) || return $?
    [ -n "$target" ] && cd "$target"
    return
  fi
  local matches
  matches=$(forgemap search "$1" --format path)
  if [ -z "$matches" ]; then
    echo "forgemap: no match for $1" >&2
    return 1
  fi
  local count
  count=$(printf '%s\\n' "$matches" | wc -l | tr -d ' ')
  if [ "$count" = "1" ]; then
    cd "$matches"
  else
    local target
    target=$(forgemap pick "$1") || return $?
    [ -n "$target" ] && cd "$target"
  fi
}
`;
}

function renderFish(fnName: string): string {
  return `# forgemap shell integration — drop into your ~/.config/fish/config.fish:
#   forgemap shell-init fish | source

function ${fnName}
  if test (count $argv) -eq 0
    set target (forgemap pick); or return $status
    if test -n "$target"
      cd "$target"
    end
    return
  end
  set matches (forgemap search $argv[1] --format path)
  if test -z "$matches"
    echo "forgemap: no match for $argv[1]" >&2
    return 1
  end
  set count (count $matches)
  if test $count -eq 1
    cd $matches[1]
  else
    set target (forgemap pick $argv[1]); or return $status
    if test -n "$target"
      cd "$target"
    end
  end
end
`;
}

export const shellInitCommand = defineCommand({
  meta: {
    name: 'shell-init',
    description:
      'Print a shell function (fcd) that resolves and cd-s into a repo. Source it via `eval "$(forgemap shell-init)"`.'
  },
  args: {
    shell: {
      type: 'positional',
      description: `Shell flavor (${SUPPORTED.join(', ')}). Auto-detected from $SHELL if omitted.`,
      required: false
    },
    name: {
      type: 'string',
      description: 'Name of the generated shell function',
      default: 'fcd'
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
    const fnName = args.name || 'fcd';
    const out = requested === 'fish' ? renderFish(fnName) : renderPosix(fnName);
    process.stdout.write(out);
  }
});
