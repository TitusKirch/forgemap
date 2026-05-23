import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { defineCommand } from 'citty';
import consola from 'consola';
import { dirname, join } from 'pathe';

type Shell = 'zsh' | 'bash' | 'fish';

const SUPPORTED: Shell[] = ['zsh', 'bash', 'fish'];

const MARKER_START = '# >>> forgemap shell-init >>>';
const MARKER_END = '# <<< forgemap shell-init <<<';

function detectShell(): Shell {
  const env = process.env.SHELL ?? '';
  if (env.endsWith('/fish')) return 'fish';
  if (env.endsWith('/bash')) return 'bash';
  return 'zsh';
}

function rcFileFor(shell: Shell): string {
  const home = homedir();
  if (shell === 'fish') return join(home, '.config', 'fish', 'config.fish');
  if (shell === 'bash') return join(home, '.bashrc');
  return join(home, '.zshrc');
}

/** Append (idempotently) a marker-guarded block that loads the wrapper at
 *  shell startup, so the user only has to re-source their rc file. */
async function install(shell: Shell, name: string): Promise<void> {
  const rc = rcFileFor(shell);
  let existing = '';
  try {
    existing = await readFile(rc, 'utf8');
  } catch {
    // rc file doesn't exist yet — we'll create it.
  }
  if (existing.includes(MARKER_START)) {
    consola.info(`forgemap shell integration already present in ${rc}.`);
    return;
  }
  const nameArg = name && name !== 'forgemap' ? ` --name ${name}` : '';
  const loadLine =
    shell === 'fish'
      ? `forgemap shell-init fish${nameArg} | source`
      : `eval "$(forgemap shell-init ${shell}${nameArg})"`;
  const block = `\n${MARKER_START}\n${loadLine}\n${MARKER_END}\n`;
  await mkdir(dirname(rc), { recursive: true });
  await appendFile(rc, block, 'utf8');
  consola.success(`Added forgemap shell integration to ${rc}.`);
  consola.info(`Run \`source ${rc}\` or restart your shell to activate it.`);
}

function renderPosix(name: string): string {
  return `# forgemap shell integration — drop into your ~/.zshrc / ~/.bashrc:
#   eval "$(forgemap shell-init)"
#
# Wraps the forgemap binary so that \`${name} cd <slug>\` actually changes
# directory in this shell. All other subcommands fall through unchanged.

${name}() {
  if [ "$1" = "cd" ]; then
    shift
    local target
    if [ "$#" -eq 0 ]; then
      target=$(command forgemap pick) || return $?
    else
      local matches
      matches=$(command forgemap search "$1" --format path)
      local count
      count=$(printf '%s' "$matches" | grep -c '^/' || true)
      if [ "$count" = "1" ]; then
        target="$matches"
      elif [ "$count" = "0" ]; then
        echo "forgemap cd: no match for $1" >&2
        return 1
      else
        target=$(command forgemap pick "$1") || return $?
      fi
    fi
    [ -n "$target" ] && builtin cd "$target"
    return
  fi
  command forgemap "$@"
}
`;
}

function renderFish(name: string): string {
  return `# forgemap shell integration — drop into your ~/.config/fish/config.fish:
#   forgemap shell-init fish | source

function ${name} --description "forgemap with cd interception"
  if test (count $argv) -ge 1 -a "$argv[1]" = "cd"
    set --erase argv[1]
    set target ""
    if test (count $argv) -eq 0
      set target (command forgemap pick); or return $status
    else
      set matches (command forgemap search $argv[1] --format path)
      set count (count $matches)
      if test $count -eq 1
        set target $matches[1]
      else if test $count -eq 0
        echo "forgemap cd: no match for $argv[1]" >&2
        return 1
      else
        set target (command forgemap pick $argv[1]); or return $status
      end
    end
    test -n "$target"; and builtin cd $target
    return
  end
  command forgemap $argv
end
`;
}

export const shellInitCommand = defineCommand({
  meta: {
    name: 'shell-init',
    description:
      'Print (or --install) a shell wrapper that adds `forgemap cd <slug>` as a real cd. Source it via `eval "$(forgemap shell-init)"`.'
  },
  args: {
    shell: {
      type: 'positional',
      description: `Shell flavor (${SUPPORTED.join(', ')}). Auto-detected from $SHELL if omitted.`,
      required: false
    },
    name: {
      type: 'string',
      description: 'Name of the generated wrapper function (default: forgemap)',
      default: 'forgemap'
    },
    install: {
      type: 'boolean',
      description:
        "Append the loader to your shell's rc file (idempotent) instead of printing",
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
    const name = args.name || 'forgemap';
    if (args.install) {
      await install(requested, name);
      return;
    }
    const out = requested === 'fish' ? renderFish(name) : renderPosix(name);
    process.stdout.write(out);
  }
});
