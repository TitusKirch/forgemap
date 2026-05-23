import type { GitForgeConfig } from '../config/schema.ts';
import { execInherit, hasCommand } from '../utils/exec.ts';
import type { CloneOptions, ForgeAdapter } from './types.ts';

function buildCloneUrl(opts: CloneOptions): string {
  const forge = opts.forge as GitForgeConfig;
  const protocol = opts.protocol ?? forge.protocol ?? 'ssh';
  if (protocol === 'https') {
    return `https://${forge.host}/${opts.owner}/${opts.repo}.git`;
  }
  return `git@${forge.host}:${opts.owner}/${opts.repo}.git`;
}

export const gitAdapter: ForgeAdapter = {
  async clone(options: CloneOptions) {
    if (!(await hasCommand('git'))) {
      throw new Error(
        '`git` is not installed. Install it from https://git-scm.com/ and try again.'
      );
    }
    const url = buildCloneUrl(options);
    const { code } = await execInherit('git', ['clone', url, options.dest]);
    if (code !== 0) {
      throw new Error(`git clone exited with code ${code}`);
    }
  }
};

// Exported for testing.
export const __test = { buildCloneUrl };
