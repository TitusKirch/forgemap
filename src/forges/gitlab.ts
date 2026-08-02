import type { ForgeConfig } from '../config/schema.ts';
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
const GLAB_TIMEOUT_MS = 20_000;

const MISSING_GLAB =
  'GitLab CLI (`glab`) is not installed. Install it from https://gitlab.com/gitlab-org/cli and run `glab auth login`.';

/**
 * Pin every invocation to the forge's own host. `glab repo clone` has no
 * `--hostname` flag, and leaning on the user's global `glab config set host`
 * would make behaviour depend on state forgemap never set.
 */
function glabEnv(forge: ForgeConfig): NodeJS.ProcessEnv {
  return { GITLAB_HOST: forge.host };
}

/** Split GitLab's `full path` into namespace and project. */
function splitFullPath(
  fullPath: string
): { owner: string; repo: string } | null {
  const segments = fullPath.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  return {
    owner: segments.slice(0, -1).join('/'),
    repo: segments.at(-1)!
  };
}

/**
 * Single-project REST check. `projects/<url-encoded path>` answers with
 * `path_with_namespace`, GitLab's counterpart to GitHub's `full_name`, so a
 * differing answer is a move and a 404 is a deletion.
 */
async function checkOne(
  forge: ForgeConfig,
  owner: string,
  repo: string
): Promise<RemoteCheckResult> {
  const path = encodeURIComponent(`${owner}/${repo}`);
  const result = await execCapture('glab', ['api', `projects/${path}`], {
    timeoutMs: GLAB_TIMEOUT_MS,
    env: glabEnv(forge)
  });
  if (result.timedOut) {
    return { state: 'unknown', reason: 'glab api timed out' };
  }
  if (result.code !== 0) {
    if (/404|not found/i.test(result.stderr)) return { state: 'gone' };
    return {
      state: 'unknown',
      reason: result.stderr.trim() || `glab api exited with code ${result.code}`
    };
  }

  let fullPath: string | undefined;
  try {
    fullPath = (JSON.parse(result.stdout) as { path_with_namespace?: string })
      .path_with_namespace;
  } catch {
    fullPath = undefined;
  }
  const canonical = fullPath ? splitFullPath(fullPath) : null;
  if (!canonical) {
    return {
      state: 'unknown',
      reason: 'could not parse glab api path_with_namespace'
    };
  }
  if (canonical.owner === owner && canonical.repo === repo) {
    return { state: 'exists', canonical };
  }
  return {
    state: 'moved',
    canonical,
    canonicalUrl: `https://${forge.host}/${canonical.owner}/${canonical.repo}.git`
  };
}

function buildQuery(chunk: RemoteCheckInput[]): string {
  const fields = chunk
    .map(
      (input, i) =>
        `  r${i}: project(fullPath: ${JSON.stringify(`${input.owner}/${input.repo}`)}) { fullPath }`
    )
    .join('\n');
  return `query {\n${fields}\n}`;
}

export const gitlabAdapter: ForgeAdapter = {
  async clone({ forge, owner, repo, dest }: CloneOptions) {
    if (!(await hasCommand('glab'))) {
      throw new Error(MISSING_GLAB);
    }
    // A subgroup path goes over as one argument, exactly as `gh repo clone`
    // takes `owner/repo`.
    const { code } = await execInherit(
      'glab',
      ['repo', 'clone', `${owner}/${repo}`, dest],
      { env: glabEnv(forge) }
    );
    if (code !== 0) {
      throw new Error(`glab repo clone exited with code ${code}`);
    }
  },

  async checkRemote({
    forge,
    owner,
    repo
  }: RemoteCheckInput): Promise<RemoteCheckResult> {
    if (!(await hasCommand('glab'))) {
      return { state: 'unknown', reason: 'glab not installed' };
    }
    return checkOne(forge, owner, repo);
  },

  /**
   * Mirrors the GitHub adapter: one aliased GraphQL request resolves up to
   * GRAPHQL_CHUNK projects, and each miss — `null` could mean gone *or*
   * renamed — costs a single REST call to tell the two apart.
   *
   * Every input in a batch belongs to one forge (the importer groups by
   * server dir), so the host is taken from the first.
   */
  async checkRemotes(inputs: RemoteCheckInput[]): Promise<RemoteCheckResult[]> {
    if (inputs.length === 0) return [];
    if (!(await hasCommand('glab'))) {
      return inputs.map(() => ({
        state: 'unknown',
        reason: 'glab not installed'
      }));
    }
    const forge = inputs[0]!.forge;

    const results: (RemoteCheckResult | null)[] = Array.from(
      { length: inputs.length },
      () => null
    );

    for (let start = 0; start < inputs.length; start += GRAPHQL_CHUNK) {
      const chunk = inputs.slice(start, start + GRAPHQL_CHUNK);
      const res = await execCapture(
        'glab',
        ['api', 'graphql', '-f', `query=${buildQuery(chunk)}`],
        { timeoutMs: GLAB_TIMEOUT_MS, env: glabEnv(forge) }
      );
      type GraphqlData = Record<string, { fullPath?: string } | null>;
      let data: GraphqlData | null = null;
      try {
        const parsed = JSON.parse(res.stdout) as {
          data?: GraphqlData;
        } & GraphqlData;
        data = parsed.data ?? parsed;
      } catch {
        data = null;
      }
      for (let i = 0; i < chunk.length; i++) {
        const node = data?.[`r${i}`];
        const canonical = node?.fullPath ? splitFullPath(node.fullPath) : null;
        if (canonical) {
          results[start + i] = { state: 'exists', canonical };
        }
        // Left null → resolved via REST fallback below.
      }
    }

    const pending = results.flatMap((r, i) => (r === null ? [i] : []));
    await mapLimit(pending, FALLBACK_CONCURRENCY, async (index) => {
      const input = inputs[index]!;
      results[index] = await checkOne(input.forge, input.owner, input.repo);
    });

    return results as RemoteCheckResult[];
  }
};
