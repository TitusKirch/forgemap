import type { ForgeConfig, GitProtocol } from '../config/schema.ts';

export interface CloneOptions {
  forge: ForgeConfig;
  owner: string;
  repo: string;
  dest: string;
  /** Override the URL protocol for this clone (git adapter only). */
  protocol?: GitProtocol;
}

export interface RemoteCheckInput {
  forge: ForgeConfig;
  owner: string;
  repo: string;
  /** Origin URL read from the local repo, when available. */
  originUrl?: string;
}

/**
 * Outcome of a remote identity check:
 *   - exists:  the remote is reachable at the given owner/repo
 *   - moved:   the remote resolved to a different canonical owner/repo
 *   - gone:    the remote no longer exists (404 / unreachable name)
 *   - unknown: could not determine (tool missing, network, not implemented)
 */
export type RemoteCheckResult =
  | { state: 'exists'; canonical: { owner: string; repo: string } }
  | {
      state: 'moved';
      canonical: { owner: string; repo: string };
      canonicalUrl?: string;
    }
  | { state: 'gone' }
  | { state: 'unknown'; reason: string };

export interface ForgeAdapter {
  clone(options: CloneOptions): Promise<void>;
  /**
   * Optional network identity check. Absent → caller treats the remote as
   * `unknown`. GitHub follows redirects so it can report moves; vanilla git
   * can only tell exists from gone.
   */
  checkRemote?(input: RemoteCheckInput): Promise<RemoteCheckResult>;
  /**
   * Optional batched variant — when present the importer prefers it over
   * looping `checkRemote`, so a forge can collapse many lookups into one
   * request (GitHub does this with a single GraphQL query). Results are
   * returned positionally, one per input.
   */
  checkRemotes?(inputs: RemoteCheckInput[]): Promise<RemoteCheckResult[]>;
}
