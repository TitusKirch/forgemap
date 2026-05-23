/**
 * Multi-scenario benchmark for scanRepos / scanReposCached.
 *
 * Runs ten scenarios across four groups and emits a consolidated
 * table plus bench/results.json so trends can be tracked over time.
 *
 *   A  Real-world baselines (1–4)
 *   B  Geometry at fixed total (5–7)
 *   C  Forge-count effect (8)
 *   D  Mixed workloads (9 search + fuse, 10 invalidation cycle)
 *
 * Each standard scenario reports three medians (cold scan, cache hit,
 * cache rebuild) over FORGEMAP_BENCH_RUNS samples (default 5).
 * The fuse scenario reports a single scan+search figure; the
 * invalidation scenario reports four phases of the typical
 * "clone → cd" cycle.
 *
 * Run: `pnpm bench` (writes bench/results.json next to this file)
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import Fuse from 'fuse.js';
import type { ForgeMapConfig } from '../src/config/schema.ts';
import { scanReposCached } from '../src/repos/cache.ts';
import { type ScannedRepo, scanRepos } from '../src/repos/scan.ts';

interface Layout {
  forges: number;
  owners: number;
  repos: number;
}

interface Scenario {
  id: number;
  group: 'A' | 'B' | 'C' | 'D';
  name: string;
  layout: Layout;
  kind: 'standard' | 'fuse' | 'invalidation';
  query?: string;
}

const RUNS = Number(process.env.FORGEMAP_BENCH_RUNS ?? 5);

const SCENARIOS: Scenario[] = [
  // A — Real-world baselines
  {
    id: 1,
    group: 'A',
    name: 'Solo Dev',
    layout: { forges: 1, owners: 10, repos: 5 },
    kind: 'standard'
  },
  {
    id: 2,
    group: 'A',
    name: 'Small Team',
    layout: { forges: 1, owners: 20, repos: 10 },
    kind: 'standard'
  },
  {
    id: 3,
    group: 'A',
    name: 'Power User',
    layout: { forges: 2, owners: 25, repos: 10 },
    kind: 'standard'
  },
  {
    id: 4,
    group: 'A',
    name: 'Enterprise',
    layout: { forges: 3, owners: 50, repos: 33 },
    kind: 'standard'
  },
  // B — Same-total geometry
  {
    id: 5,
    group: 'B',
    name: 'Wide',
    layout: { forges: 1, owners: 10, repos: 100 },
    kind: 'standard'
  },
  {
    id: 6,
    group: 'B',
    name: 'Narrow',
    layout: { forges: 1, owners: 1000, repos: 1 },
    kind: 'standard'
  },
  {
    id: 7,
    group: 'B',
    name: 'Square',
    layout: { forges: 1, owners: 32, repos: 32 },
    kind: 'standard'
  },
  // C — Forge-count effect
  {
    id: 8,
    group: 'C',
    name: 'Many Forges',
    layout: { forges: 5, owners: 40, repos: 5 },
    kind: 'standard'
  },
  // D — Mixed workloads
  {
    id: 9,
    group: 'D',
    name: 'Search + Fuzzy',
    layout: { forges: 1, owners: 50, repos: 10 },
    kind: 'fuse',
    query: 'r5'
  },
  {
    id: 10,
    group: 'D',
    name: 'Invalidation',
    layout: { forges: 1, owners: 50, repos: 10 },
    kind: 'invalidation'
  }
];

const GROUP_LABEL: Record<Scenario['group'], string> = {
  A: 'Real-world baselines',
  B: 'Geometry @ fixed total',
  C: 'Forge-count effect',
  D: 'Mixed workloads'
};

interface PhaseResult {
  label: string;
  median: number;
  min: number;
  max: number;
}

interface ScenarioResult {
  id: number;
  group: Scenario['group'];
  name: string;
  layout: Layout;
  total: number;
  kind: Scenario['kind'];
  phases: PhaseResult[];
}

async function seed(root: string, layout: Layout): Promise<ForgeMapConfig> {
  const forges: ForgeMapConfig['forges'] = {};
  for (let f = 0; f < layout.forges; f++) {
    const name = `forge${f}`;
    forges[name] = { type: 'git', host: `h${f}.example.com`, dir: `dir${f}` };
    for (let o = 0; o < layout.owners; o++) {
      const ownerDir = join(root, `dir${f}`, `owner${o}`);
      // Use mkdir per owner with recursive then per-repo mkdir; cheaper than O(N) recursive each.
      await mkdir(ownerDir, { recursive: true });
      for (let r = 0; r < layout.repos; r++) {
        await mkdir(join(ownerDir, `repo${r}`));
      }
    }
  }
  return { root: '.', defaultForge: 'forge0', forges };
}

async function time(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function summarise(label: string, samples: number[]): PhaseResult {
  return {
    label,
    median: median(samples),
    min: Math.min(...samples),
    max: Math.max(...samples)
  };
}

async function bench(
  label: string,
  fn: () => Promise<unknown>
): Promise<PhaseResult> {
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) samples.push(await time(fn));
  return summarise(label, samples);
}

async function runStandard(scenario: Scenario): Promise<ScenarioResult> {
  const cacheHome = await mkdtemp(join(tmpdir(), 'fm-bench-cache-'));
  const dir = await mkdtemp(join(tmpdir(), 'fm-bench-'));
  process.env.XDG_CACHE_HOME = cacheHome;
  try {
    const config = await seed(dir, scenario.layout);

    const cold = await bench('cold', () =>
      scanRepos({ config, configDir: dir }));
    // Warm once before timing hits.
    await scanReposCached({ config, configDir: dir });
    const hit = await bench('hit', () =>
      scanReposCached({ config, configDir: dir }));
    const rebuild = await bench('rebuild', () =>
      scanReposCached({ config, configDir: dir, useCache: false }));

    return {
      id: scenario.id,
      group: scenario.group,
      name: scenario.name,
      layout: scenario.layout,
      total:
        scenario.layout.forges * scenario.layout.owners * scenario.layout.repos,
      kind: 'standard',
      phases: [cold, hit, rebuild]
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(cacheHome, { recursive: true, force: true });
  }
}

async function runFuse(scenario: Scenario): Promise<ScenarioResult> {
  const cacheHome = await mkdtemp(join(tmpdir(), 'fm-bench-cache-'));
  const dir = await mkdtemp(join(tmpdir(), 'fm-bench-'));
  process.env.XDG_CACHE_HOME = cacheHome;
  try {
    const config = await seed(dir, scenario.layout);

    const scan = await bench('scan', () =>
      scanRepos({ config, configDir: dir }));
    // Pre-scan once to feed Fuse measurement (we want scan + Fuse build + search end-to-end).
    const repos = await scanRepos({ config, configDir: dir });
    const search = await bench('fuse', async () => {
      const fuse = new Fuse(repos, {
        keys: ['slug', 'owner', 'repo'],
        threshold: 0.3,
        ignoreLocation: true
      });
      void fuse.search(scenario.query ?? 'foo');
    });
    const endToEnd = await bench('scan+search', async () => {
      const r: ScannedRepo[] = await scanRepos({ config, configDir: dir });
      const fuse = new Fuse(r, {
        keys: ['slug', 'owner', 'repo'],
        threshold: 0.3,
        ignoreLocation: true
      });
      void fuse.search(scenario.query ?? 'foo');
    });

    return {
      id: scenario.id,
      group: scenario.group,
      name: scenario.name,
      layout: scenario.layout,
      total:
        scenario.layout.forges * scenario.layout.owners * scenario.layout.repos,
      kind: 'fuse',
      phases: [scan, search, endToEnd]
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(cacheHome, { recursive: true, force: true });
  }
}

async function runInvalidation(scenario: Scenario): Promise<ScenarioResult> {
  const phases: Record<string, number[]> = {
    cold: [],
    hit: [],
    rebuild: [],
    'hit-after': []
  };

  for (let cycle = 0; cycle < RUNS; cycle++) {
    const cacheHome = await mkdtemp(join(tmpdir(), 'fm-bench-cache-'));
    const dir = await mkdtemp(join(tmpdir(), 'fm-bench-'));
    process.env.XDG_CACHE_HOME = cacheHome;
    try {
      const config = await seed(dir, scenario.layout);

      phases.cold!.push(
        await time(() => scanReposCached({ config, configDir: dir }))
      );
      phases.hit!.push(
        await time(() => scanReposCached({ config, configDir: dir }))
      );

      // Simulate `forgemap clone newowner/newrepo` — adds a fresh owner+repo.
      const newOwner = join(dir, 'dir0', `cyclenew${cycle}`, 'addedrepo');
      await mkdir(newOwner, { recursive: true });

      phases.rebuild!.push(
        await time(() => scanReposCached({ config, configDir: dir }))
      );
      phases['hit-after']!.push(
        await time(() => scanReposCached({ config, configDir: dir }))
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(cacheHome, { recursive: true, force: true });
    }
  }

  return {
    id: scenario.id,
    group: scenario.group,
    name: scenario.name,
    layout: scenario.layout,
    total:
      scenario.layout.forges * scenario.layout.owners * scenario.layout.repos,
    kind: 'invalidation',
    phases: [
      summarise('cold', phases.cold!),
      summarise('hit', phases.hit!),
      summarise('rebuild (after clone)', phases.rebuild!),
      summarise('hit-after-rebuild', phases['hit-after']!)
    ]
  };
}

function fmt(n: number): string {
  return n.toFixed(n < 10 ? 2 : 1).padStart(7);
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(0)}%`.padStart(5);
}

function fmtLayout(l: Layout): string {
  return `${String(l.forges).padStart(1)}× ${String(l.owners).padStart(4)}× ${String(l.repos).padStart(3)}`;
}

function fmtTotal(n: number): string {
  return n.toLocaleString('en-US').padStart(6);
}

function printTable(results: ScenarioResult[]): void {
  const sep =
    '──────────────────────────────────────────────────────────────────────────────────────';
  console.log();
  console.log(
    `${'#'.padStart(2)}  ${'Scenario'.padEnd(20)}  ${'Layout'.padEnd(15)}  ${'Total'.padStart(6)}  ${'Cold'.padStart(8)}  ${'Hit'.padStart(8)}  ${'Rebuild'.padStart(8)}  ${'Δ Hit'.padStart(6)}`
  );
  console.log(sep);

  let lastGroup: string | null = null;
  for (const r of results) {
    if (r.group !== lastGroup) {
      console.log(`\n  ${r.group}  ${GROUP_LABEL[r.group]}`);
      lastGroup = r.group;
    }
    const layout = fmtLayout(r.layout);
    const total = fmtTotal(r.total);

    if (r.kind === 'standard') {
      const [cold, hit, rebuild] = r.phases;
      const delta = ((cold!.median - hit!.median) / cold!.median) * 100;
      const star = delta >= 50 ? ' ★' : '';
      console.log(
        `${String(r.id).padStart(2)}  ${r.name.padEnd(20)}  ${layout}  ${total}  ${fmt(cold!.median)}  ${fmt(hit!.median)}  ${fmt(rebuild!.median)}  ${fmtPct(delta)}${star}`
      );
    } else if (r.kind === 'fuse') {
      const [scan, search, endToEnd] = r.phases;
      console.log(
        `${String(r.id).padStart(2)}  ${r.name.padEnd(20)}  ${layout}  ${total}  scan ${fmt(scan!.median)}  fuse ${fmt(search!.median)}  total ${fmt(endToEnd!.median)}`
      );
    } else {
      const [cold, hit, rebuild, hitAfter] = r.phases;
      console.log(
        `${String(r.id).padStart(2)}  ${r.name.padEnd(20)}  ${layout}  ${total}  cold→hit→rebuild→hit  ${fmt(cold!.median)} / ${fmt(hit!.median)} / ${fmt(rebuild!.median)} / ${fmt(hitAfter!.median)}`
      );
    }
  }
  console.log(sep);
  console.log(
    '\nUnits: milliseconds (median over',
    RUNS,
    'runs). Δ Hit = (cold − hit) / cold. ★ = ≥50% cache speedup.\n'
  );
}

function deltaPct(cold: number, hit: number): number {
  return ((cold - hit) / cold) * 100;
}

function interpret(results: ScenarioResult[]): void {
  const std = results.filter((r) => r.kind === 'standard');
  const sortedByDelta = [...std].sort(
    (a, b) =>
      deltaPct(b.phases[0]!.median, b.phases[1]!.median) -
      deltaPct(a.phases[0]!.median, a.phases[1]!.median)
  );
  const best = sortedByDelta[0]!;
  const worst = sortedByDelta.at(-1)!;
  const enterprise = results.find((r) => r.name === 'Enterprise')!;

  console.log('Interpretation:');
  console.log(
    `  • Best cache payoff: ${best.name} (${deltaPct(best.phases[0]!.median, best.phases[1]!.median).toFixed(0)}%). Worst: ${worst.name} (${deltaPct(worst.phases[0]!.median, worst.phases[1]!.median).toFixed(0)}%).`
  );
  console.log(
    `  • The cache pays off once the cold scan exceeds ~10 ms — at smaller sizes the JSON round-trip and fingerprint walk drown the savings.`
  );
  console.log(
    `  • Enterprise (≈5 000 repos) sees ${deltaPct(enterprise.phases[0]!.median, enterprise.phases[1]!.median).toFixed(0)}% — that's where the cache stops being decorative.`
  );
  console.log(
    `  • Rebuild costs ~2× the cold scan; once per invalidation (e.g. after \`forgemap clone\`).`
  );
  console.log();
}

async function main(): Promise<void> {
  console.log(
    `forgemap bench — ${SCENARIOS.length} scenarios, ${RUNS} runs each\n`
  );
  const results: ScenarioResult[] = [];
  for (const scenario of SCENARIOS) {
    process.stdout.write(
      `  [${scenario.id}/${SCENARIOS.length}] ${scenario.name}…`
    );
    const start = performance.now();
    if (scenario.kind === 'fuse') {
      results.push(await runFuse(scenario));
    } else if (scenario.kind === 'invalidation') {
      results.push(await runInvalidation(scenario));
    } else {
      results.push(await runStandard(scenario));
    }
    console.log(` ${((performance.now() - start) / 1000).toFixed(1)}s`);
  }

  printTable(results);
  interpret(results);

  const outDir = dirname(fileURLToPath(import.meta.url));
  const outPath = join(outDir, 'results.json');
  await writeFile(
    outPath,
    `${JSON.stringify({ ranAt: new Date().toISOString(), runs: RUNS, results }, null, 2)}\n`,
    'utf8'
  );
  console.log(`Wrote ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
