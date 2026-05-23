/**
 * Micro-benchmark for scanRepos / scanReposCached.
 *
 * Builds a fake projects layout in a tmpdir with N owner directories
 * across M forges and K repos per owner, then times:
 *
 *   1. Cold scan      (no cache, walks the filesystem)
 *   2. Cached scan    (cache hit, just reads the JSON)
 *   3. Cache rebuild  (no-cache=true, forces a fresh write)
 *
 * Run with: `pnpm bench`
 *
 * Knobs via env vars:
 *   FORGEMAP_BENCH_FORGES   default 3
 *   FORGEMAP_BENCH_OWNERS   default 20
 *   FORGEMAP_BENCH_REPOS    default 8         (per owner)
 *   FORGEMAP_BENCH_RUNS     default 5
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { ForgeMapConfig } from '../src/config/schema.ts';
import { scanReposCached } from '../src/repos/cache.ts';
import { scanRepos } from '../src/repos/scan.ts';

const FORGES = Number(process.env.FORGEMAP_BENCH_FORGES ?? 3);
const OWNERS = Number(process.env.FORGEMAP_BENCH_OWNERS ?? 20);
const REPOS = Number(process.env.FORGEMAP_BENCH_REPOS ?? 8);
const RUNS = Number(process.env.FORGEMAP_BENCH_RUNS ?? 5);

async function seed(root: string): Promise<ForgeMapConfig> {
  const forges: ForgeMapConfig['forges'] = {};
  for (let f = 0; f < FORGES; f++) {
    const name = `forge${f}`;
    forges[name] = {
      type: 'git',
      host: `git${f}.example.com`,
      dir: `dir${f}`
    };
    for (let o = 0; o < OWNERS; o++) {
      for (let r = 0; r < REPOS; r++) {
        await mkdir(join(root, `dir${f}`, `owner${o}`, `repo${r}`), {
          recursive: true
        });
      }
    }
  }
  return {
    root: '.',
    defaultForge: 'forge0',
    forges
  };
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

async function time(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

async function bench(label: string, fn: () => Promise<unknown>): Promise<void> {
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) samples.push(await time(fn));
  const min = Math.min(...samples).toFixed(2);
  const med = median(samples).toFixed(2);
  const max = Math.max(...samples).toFixed(2);
  console.log(
    `${label.padEnd(28)} min ${min.padStart(7)} ms  median ${med.padStart(7)} ms  max ${max.padStart(7)} ms`
  );
}

async function main() {
  const totalRepos = FORGES * OWNERS * REPOS;
  console.log(
    `Layout: ${FORGES} forges × ${OWNERS} owners × ${REPOS} repos = ${totalRepos} dirs · ${RUNS} runs each\n`
  );

  const tmpHome = await mkdtemp(join(tmpdir(), 'forgemap-bench-cache-'));
  process.env.XDG_CACHE_HOME = tmpHome;
  const dir = await mkdtemp(join(tmpdir(), 'forgemap-bench-'));

  try {
    const config = await seed(dir);

    await bench('scanRepos (filesystem)', () =>
      scanRepos({ config, configDir: dir }));

    // Warm the cache once before timing the hits.
    await scanReposCached({ config, configDir: dir });

    await bench('scanReposCached (hit)', () =>
      scanReposCached({ config, configDir: dir }));

    await bench('scanReposCached (rebuild)', () =>
      scanReposCached({ config, configDir: dir, useCache: false }));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(tmpHome, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
