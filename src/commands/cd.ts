import { defineCommand } from 'citty';
import consola from 'consola';

/**
 * When the shell wrapper from `forgemap shell-init` is sourced, it
 * intercepts `forgemap cd <slug>` before the binary is called and runs
 * the actual `cd` in the user's shell. If the binary itself ever runs
 * this command, the wrapper isn't active — we print a hint so the user
 * knows how to enable it.
 */
export const cdCommand = defineCommand({
  meta: {
    name: 'cd',
    description: 'Change directory into a repo (requires shell integration)'
  },
  args: {
    slug: {
      type: 'positional',
      description: 'owner/repo, forge:owner/repo, full URL, or fuzzy query',
      required: false
    }
  },
  async run() {
    consola.error(
      'forgemap cd needs shell integration to actually change directory.'
    );
    consola.info('Source the wrapper once and try again:');
    consola.info('  eval "$(forgemap shell-init)"     # zsh/bash');
    consola.info('  forgemap shell-init fish | source # fish');
    consola.info(
      'Or, if you just want the path on stdout, use: forgemap path <slug>'
    );
    process.exitCode = 1;
  }
});
