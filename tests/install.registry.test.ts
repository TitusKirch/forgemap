import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLatestVersion } from '../src/install/registry.ts';

const ENV_KEYS = ['FORGEMAP_REGISTRY', 'FORGEMAP_REGISTRY_TIMEOUT_MS'];

let saved: Record<string, string | undefined> = {};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** The URL the one call under test was made against. */
function requestedUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  return String(fetchMock.mock.calls[0]?.[0]);
}

describe('fetchLatestVersion', () => {
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
  });

  it('reads the version off the latest dist-tag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ version: '1.2.3' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLatestVersion()).resolves.toEqual({
      version: '1.2.3',
      error: null
    });
    expect(requestedUrl(fetchMock)).toBe(
      'https://registry.npmjs.org/forgemap/latest'
    );
  });

  it('asks about the package it is told to', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ version: '1.0.0' }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchLatestVersion('other-pkg');
    expect(requestedUrl(fetchMock)).toBe(
      'https://registry.npmjs.org/other-pkg/latest'
    );
  });

  it('honours FORGEMAP_REGISTRY and strips its trailing slashes', async () => {
    process.env.FORGEMAP_REGISTRY = 'https://npm.acme.test/';
    const fetchMock = vi.fn().mockResolvedValue(json({ version: '2.0.0' }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchLatestVersion();
    expect(requestedUrl(fetchMock)).toBe(
      'https://npm.acme.test/forgemap/latest'
    );
  });

  it('reports a non-ok response instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 404)));

    await expect(fetchLatestVersion()).resolves.toEqual({
      version: null,
      error: 'the registry responded 404'
    });
  });

  it('reports an answer that carries no version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ name: 'x' })));

    await expect(fetchLatestVersion()).resolves.toEqual({
      version: null,
      error: 'the registry answer carried no version'
    });
  });

  it('names the timeout when the request is aborted', async () => {
    process.env.FORGEMAP_REGISTRY_TIMEOUT_MS = '250';
    const timeout = Object.assign(new Error('aborted'), {
      name: 'TimeoutError'
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));

    await expect(fetchLatestVersion()).resolves.toEqual({
      version: null,
      error: 'the registry did not answer within 250 ms'
    });
  });

  it('falls back to the default timeout when the override is unusable', async () => {
    process.env.FORGEMAP_REGISTRY_TIMEOUT_MS = 'soon';
    const timeout = Object.assign(new Error('aborted'), {
      name: 'TimeoutError'
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));

    await expect(fetchLatestVersion()).resolves.toEqual({
      version: null,
      error: 'the registry did not answer within 5000 ms'
    });
  });

  it('surfaces a transport failure as its message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
    );

    await expect(fetchLatestVersion()).resolves.toEqual({
      version: null,
      error: 'getaddrinfo ENOTFOUND'
    });
  });
});
