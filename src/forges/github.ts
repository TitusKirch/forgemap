import { execInherit, hasCommand } from '../utils/exec.ts';
import type { CloneOptions, ForgeAdapter } from './types.ts';

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
  }
};
