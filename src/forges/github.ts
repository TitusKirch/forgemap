import { mapLimit } from '../utils/concurrency.ts';
import { execCapture, execInherit, hasCommand } from '../utils/exec.ts';
import type {
  CloneOptions,
  ForgeAdapter,
  RemoteCheckInput,
  RemoteCheckResult
} from './types.ts';

const GRAPHQL_CHUNK = 100;
const FALLBACK_CONCURRENCY = 8;

/** Single-repo REST check. `gh api` follows the redirect a renamed/transferred
 *  repo issues, so the returned full_name reveals the canonical owner/repo. */
async function checkOne(
  owner: string,
  repo: string
): Promise<RemoteCheckResult> {
  const result = await execCapture('gh', [
    'api',
    `repos/${owner}/${repo}`,
    '--jq',
    '.full_name'
  ]);
  if (result.code !== 0) {
    if (/404|not found/i.test(result.stderr)) return { state: 'gone' };
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

function buildQuery(chunk: RemoteCheckInput[]): string {
  const fields = chunk
    .map(
      (input, i) =>
        `  r${i}: repository(owner: ${JSON.stringify(input.owner)}, name: ${JSON.stringify(input.repo)}) { nameWithOwner }`
    )
    .join('\n');
  return `query {\n${fields}\n}`;
}

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
    return checkOne(owner, repo);
  },

  /**
   * One GraphQL request resolves up to GRAPHQL_CHUNK repos at once. GraphQL
   * does not follow rename redirects, so a hit means `exists`; a null/miss
   * could be either `gone` or `moved` and is disambiguated with a single
   * (redirect-following) REST call, run concurrency-limited.
   */
  async checkRemotes(inputs: RemoteCheckInput[]): Promise<RemoteCheckResult[]> {
    if (inputs.length === 0) return [];
    if (!(await hasCommand('gh'))) {
      return inputs.map(() => ({
        state: 'unknown',
        reason: 'gh not installed'
      }));
    }

    const results: (RemoteCheckResult | null)[] = Array.from(
      { length: inputs.length },
      () => null
    );

    for (let start = 0; start < inputs.length; start += GRAPHQL_CHUNK) {
      const chunk = inputs.slice(start, start + GRAPHQL_CHUNK);
      const res = await execCapture('gh', [
        'api',
        'graphql',
        '-f',
        `query=${buildQuery(chunk)}`
      ]);
      type GraphqlData = Record<string, { nameWithOwner?: string } | null>;
      let data: GraphqlData | null = null;
      try {
        data = (JSON.parse(res.stdout) as { data?: GraphqlData }).data ?? null;
      } catch {
        data = null;
      }
      for (let i = 0; i < chunk.length; i++) {
        const node = data?.[`r${i}`];
        if (node?.nameWithOwner) {
          const [owner, repo] = node.nameWithOwner.split('/');
          if (owner && repo) {
            results[start + i] = {
              state: 'exists',
              canonical: { owner, repo }
            };
          }
        }
        // Left null → resolved via REST fallback below.
      }
    }

    const pending = results.flatMap((r, i) => (r === null ? [i] : []));
    await mapLimit(pending, FALLBACK_CONCURRENCY, async (index) => {
      results[index] = await checkOne(
        inputs[index]!.owner,
        inputs[index]!.repo
      );
    });

    return results as RemoteCheckResult[];
  }
};
