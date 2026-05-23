import type {
  ForgeConfig,
  GitForgeConfig,
  GitProtocol
} from '../config/schema.ts';
import { execCapture, execInherit, hasCommand } from '../utils/exec.ts';
import type {
  CloneOptions,
  ForgeAdapter,
  RemoteCheckInput,
  RemoteCheckResult
} from './types.ts';

interface UrlParts {
  forge: ForgeConfig;
  owner: string;
  repo: string;
  protocol?: GitProtocol;
}

function buildCloneUrl(opts: UrlParts): string {
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
  },

  async checkRemote(input: RemoteCheckInput): Promise<RemoteCheckResult> {
    if (!(await hasCommand('git'))) {
      return { state: 'unknown', reason: 'git not installed' };
    }
    // `git ls-remote` only proves reachability — it cannot detect a rename.
    const url = input.originUrl ?? buildCloneUrl(input);
    const result = await execCapture('git', ['ls-remote', url]);
    if (result.code === 0) {
      return {
        state: 'exists',
        canonical: { owner: input.owner, repo: input.repo }
      };
    }
    return { state: 'gone' };
  }
};

// Exported for testing.
export const __test = { buildCloneUrl };
