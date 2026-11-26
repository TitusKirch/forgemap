import { defineCommand } from 'citty';
import consola from 'consola';
import { colors } from 'consola/utils';
import {
  classifyInstall,
  formatCommand,
  PACKAGE_NAME,
  resolveBinary,
  updateBlocker
} from '../install/detect.ts';
import { fetchLatestVersion } from '../install/registry.ts';
import { isOutdated } from '../install/version.ts';
import { canPrompt } from '../repos/picker.ts';
import { execInherit } from '../utils/exec.ts';

// Injected at build time by vite's `define` (see vite.config.ts), sourced from
// package.json's `version` — the same literal `info` and `--version` report.
declare const __APP_VERSION__: string;

function row(label: string, value: string): string {
  return `  ${colors.dim(label.padEnd(9))} ${value}\n`;
}

export const selfUpdateCommand = defineCommand({
  meta: {
    name: 'self-update',
    description:
      'Update forgemap itself — detect which package manager owns this install, show its exact command, and ask before running it'
  },
  args: {
    check: {
      type: 'boolean',
      description:
        'Only report whether a newer version exists (exit 1 when outdated); never prompt or run',
      default: false
    },
    print: {
      type: 'boolean',
      description:
        'Print just the update command for this install, without asking the registry',
      default: false
    },
    json: {
      type: 'boolean',
      description: 'Emit a machine-readable JSON report',
      default: false
    },
    yes: {
      type: 'boolean',
      description:
        'Skip the confirmation and run the update command right away',
      default: false
    }
  },
  async run({ args }) {
    const install = classifyInstall(resolveBinary(process.argv[1]));
    const command = install.command ? formatCommand(install.command) : null;
    const blocker = updateBlocker(install);
    const current = __APP_VERSION__;

    // `--print` stays offline on purpose: it answers "what updates this
    // install", which the registry has no say in, and exists to be dropped into
    // a shell as `$(forgemap self-update --print)`.
    if (args.print) {
      if (!command) {
        consola.error(`No update command for this install — ${blocker}.`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`${command}\n`);
      return;
    }

    const { version: latest, error } = await fetchLatestVersion();
    const outdated = Boolean(latest && isOutdated(current, latest));

    if (args.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            current,
            latest,
            outdated,
            install: {
              kind: install.kind,
              packageRoot: install.packageRoot,
              reason: install.reason,
              writable: install.writable
            },
            command,
            blocked: blocker,
            error
          },
          null,
          2
        )}\n`
      );
      if (error || outdated) process.exitCode = 1;
      return;
    }

    if (error) {
      consola.error(
        `Could not ask the registry for the latest version — ${error}.`
      );
      if (command) {
        consola.info(`Update it yourself with: ${colors.cyan(command)}`);
      }
      process.exitCode = 1;
      return;
    }

    if (!outdated) {
      // A version *ahead* of the registry is normal on a dev build, so name the
      // registry's answer instead of implying the two agree.
      const trailer =
        latest && latest !== current ? ` (registry latest: v${latest})` : '';
      consola.success(
        `forgemap ${colors.cyan(`v${current}`)} is up to date${trailer}.`
      );
      return;
    }

    consola.info(
      `forgemap ${colors.yellow(`v${current}`)} → ${colors.green(`v${latest}`)}`
    );
    let report = row(
      'install',
      `${install.kind} ${colors.dim(`(${install.reason})`)}`
    );
    if (install.packageRoot) report += row('path', install.packageRoot);
    if (command) report += row('command', colors.cyan(command));
    process.stdout.write(report);

    if (args.check) {
      process.exitCode = 1;
      return;
    }

    if (blocker || !install.command) {
      consola.warn(`Not running anything — ${blocker}.`);
      if (!command) {
        consola.info(
          `A global install updates with: ${colors.cyan(`npm install -g ${PACKAGE_NAME}@latest`)}`
        );
      }
      process.exitCode = 1;
      return;
    }

    let confirmed = args.yes;
    if (!confirmed) {
      if (!canPrompt()) {
        consola.error(
          'Refusing to update without --yes: nobody to confirm. Or run the command above yourself.'
        );
        process.exitCode = 1;
        return;
      }
      const answer = await consola.prompt(`Type "yes" to run ${command}:`, {
        type: 'text',
        cancel: 'null'
      });
      confirmed = typeof answer === 'string' && answer.trim() === 'yes';
    }
    if (!confirmed) {
      consola.info('Aborted — nothing updated.');
      return;
    }

    // The installer rewrites the files this process is running from, so nothing
    // may happen after it returns: no cache write, no second lookup — hand its
    // exit code straight back.
    const result = await execInherit(install.command.bin, install.command.args);
    if (result.code !== 0) {
      consola.fail(`${command} exited with code ${result.code}.`);
      process.exitCode = result.code;
      return;
    }
    consola.success(`Updated forgemap to v${latest}.`);
  }
});
