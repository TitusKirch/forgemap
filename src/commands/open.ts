import { spawn } from 'node:child_process';
import { defineCommand } from 'citty';
import consola from 'consola';
import { dirname } from 'pathe';
import { loadForgeMapConfig } from '../config/load.ts';
import { resolveRepoPath } from '../slug/locate.ts';

interface OpenInvocation {
  cmd: string;
  args: string[];
}

function platformOpen(localPath: string): OpenInvocation {
  const distro = process.env.WSL_DISTRO_NAME;
  if (distro) {
    const winPath = `\\\\wsl$\\${distro}${localPath.replaceAll('/', '\\')}`;
    return { cmd: 'explorer.exe', args: [winPath] };
  }
  if (process.platform === 'darwin') {
    return { cmd: 'open', args: [localPath] };
  }
  return { cmd: 'xdg-open', args: [localPath] };
}

export const openCommand = defineCommand({
  meta: {
    name: 'open',
    description:
      'Open a repo in the OS file manager (Explorer on WSL, Finder on macOS, xdg-open elsewhere)'
  },
  args: {
    slug: {
      type: 'positional',
      description:
        'owner/repo, forge:owner/repo, full URL, or a fuzzy query matched against cloned repos',
      required: true
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
    const localPath = await resolveRepoPath(args.slug, {
      config: loaded.config,
      configDir
    });
    if (!localPath) {
      process.exitCode = 1;
      return;
    }

    const { cmd, args: cmdArgs } = platformOpen(localPath);
    consola.info(`Opening ${localPath}`);

    const child = spawn(cmd, cmdArgs, {
      stdio: 'ignore',
      detached: true
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        consola.error(
          `Could not find \`${cmd}\`. Install it (or open the path manually).`
        );
        process.exitCode = 1;
      } else {
        consola.error(error.message);
        process.exitCode = 1;
      }
    });
    child.unref();
  }
});
