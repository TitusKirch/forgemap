import { PACKAGE_NAME } from './detect.ts';

/**
 * The CLI's only outbound HTTP call, and it is reached from `self-update`
 * alone — never from a command that merely reads the disk. Like every other
 * network operation in forgemap it runs under a hard timeout, so an unreachable
 * registry cannot wedge a run.
 */
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_TIMEOUT_MS = 5_000;

export interface LatestLookup {
  version: string | null;
  /** Why the lookup failed, or null when `version` is set. */
  error: string | null;
}

/** Set `FORGEMAP_REGISTRY` to point at a mirror or a private registry. */
function registryBase(): string {
  const configured = process.env.FORGEMAP_REGISTRY?.trim();
  return (configured || DEFAULT_REGISTRY).replace(/\/+$/, '');
}

/** Set `FORGEMAP_REGISTRY_TIMEOUT_MS` to override the default 5 000 ms. */
function timeoutMs(): number {
  const raw = process.env.FORGEMAP_REGISTRY_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/** Ask the registry for the `latest` dist-tag's version. Never throws. */
export async function fetchLatestVersion(
  packageName: string = PACKAGE_NAME
): Promise<LatestLookup> {
  const timeout = timeoutMs();
  try {
    const response = await fetch(`${registryBase()}/${packageName}/latest`, {
      signal: AbortSignal.timeout(timeout),
      headers: { accept: 'application/json' }
    });
    if (!response.ok) {
      return {
        version: null,
        error: `the registry responded ${response.status}`
      };
    }
    const body = (await response.json()) as { version?: unknown };
    if (typeof body.version !== 'string') {
      return { version: null, error: 'the registry answer carried no version' };
    }
    return { version: body.version, error: null };
  } catch (error) {
    const failure = error as Error;
    return {
      version: null,
      error:
        failure.name === 'TimeoutError'
          ? `the registry did not answer within ${timeout} ms`
          : failure.message
    };
  }
}
