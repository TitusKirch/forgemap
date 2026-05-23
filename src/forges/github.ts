import { execCapture, execInherit, hasCommand } from '../utils/exec.ts';
import type {
  CloneOptions,
  ForgeAdapter,
  RemoteCheckInput,
  RemoteCheckResult
} from './types.ts';

export const githubAdapter: ForgeAdapter = {
  async clone({ owner, repo, dest }: CloneOptions) {
    if (!(await hasCommand('gh'))) {
      throw new Error(
        'GitHub CLI (`gh`) is not installed. Install it from https://cli.github.com/ and run `gh auth login`.'
      );
    }
    const { code } = await execInherit('gh', [
      'repo',
      'clone',
      `${owner}/${repo}`,
      dest
    ]);
    if (code !== 0) {
      throw new Error(`gh repo clone exited with code ${code}`);
    }
  },

  async checkRemote({
    owner,
    repo
  }: RemoteCheckInput): Promise<RemoteCheckResult> {
    if (!(await hasCommand('gh'))) {
      return { state: 'unknown', reason: 'gh not installed' };
    }
    // `gh api` follows the redirect a renamed/transferred repo issues, so the
    // returned full_name reveals the canonical owner/repo.
    const result = await execCapture('gh', [
      'api',
      `repos/${owner}/${repo}`,
      '--jq',
      '.full_name'
    ]);
    if (result.code !== 0) {
      if (/404|not found/i.test(result.stderr)) {
        return { state: 'gone' };
      }
      return {
        state: 'unknown',
        reason: result.stderr.trim() || `gh api exited with code ${result.code}`
      };
    }
    const fullName = result.stdout.trim();
    const [canonicalOwner, canonicalRepo] = fullName.split('/');
    if (!canonicalOwner || !canonicalRepo) {
      return { state: 'unknown', reason: 'could not parse gh api full_name' };
    }
    const canonical = { owner: canonicalOwner, repo: canonicalRepo };
    if (canonicalOwner === owner && canonicalRepo === repo) {
      return { state: 'exists', canonical };
    }
    return {
      state: 'moved',
      canonical,
      canonicalUrl: `https://github.com/${canonicalOwner}/${canonicalRepo}.git`
    };
  }
};
