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

const REMOTE_TIMEOUT_MS = 10_000;

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
    // Force non-interactive SSH and a hard timeout so an unreachable or
    // auth-prompting host can't wedge the whole import.
    const url = input.originUrl ?? buildCloneUrl(input);
    const result = await execCapture('git', ['ls-remote', url], {
      timeoutMs: REMOTE_TIMEOUT_MS,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oConnectTimeout=5'
      }
    });
    if (result.timedOut) {
      return { state: 'unknown', reason: 'ls-remote timed out' };
    }
    if (result.code === 0) {
      return {
        state: 'exists',
        canonical: { owner: input.owner, repo: input.repo }
      };
    }
    // A failure is only `gone` when the host clearly says the repo is missing.
    // Unreachable hosts, auth failures, and the generic SSH error stay
    // `unknown` so we never falsely declare a repo deleted (the generic SSH
    // message even contains "the repository exists").
    if (isRepoMissing(result.stderr)) {
      return { state: 'gone' };
    }
    const reason =
      result.stderr
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean) ?? `git ls-remote exited with code ${result.code}`;
    return { state: 'unknown', reason };
  }
};

/** True only for an unambiguous "this repository does not exist" signal. */
function isRepoMissing(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    /repository not found/.test(s) ||
    /remote:.*not found/.test(s) ||
    /\b404\b/.test(s) ||
    /could not find repository/.test(s)
  );
}

// Exported for testing.
export const __test = { buildCloneUrl, isRepoMissing };
