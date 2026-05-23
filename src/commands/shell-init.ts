import { defineCommand } from 'citty';
import consola from 'consola';
import {
  type Shell,
  SUPPORTED_SHELLS as SUPPORTED,
  detectShell,
  installRcBlock
} from '../utils/shell.ts';

/** Append (idempotently) a loader that, plus completion, sets up the shell so
 *  the user only has to re-source their rc file. */
async function install(shell: Shell, name: string): Promise<void> {
  const nameArg = name && name !== 'forgemap' ? ` --name ${name}` : '';
  const loaders =
    shell === 'fish'
      ? [
          `forgemap shell-init fish${nameArg} | source`,
          'forgemap completion fish | source'
        ]
      : [
          `eval "$(forgemap shell-init ${shell}${nameArg})"`,
          `eval "$(forgemap completion ${shell})"`
        ];
  // 'shell-init' is the legacy label (before this block also loaded
  // completion) — strip it so a re-install never leaves a duplicate.
  const { status, rcFile } = await installRcBlock(shell, 'shell', loaders, [
    'shell-init'
  ]);
  if (status === 'present') {
    consola.info(`forgemap shell integration already present in ${rcFile}.`);
    return;
  }
  const verb = status === 'updated' ? 'Updated' : 'Added';
  consola.success(
    `${verb} forgemap shell integration (cd + completion) in ${rcFile}.`
  );
  consola.info(
    `Run \`source ${rcFile}\` or restart your shell to activate it.`
  );
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
