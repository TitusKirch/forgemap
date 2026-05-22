# Sandbox

A throwaway playground for trying `forgemap` without touching your real
`~/projects` layout. Everything below `examples/sandbox/` is git-ignored
except this file, the config, and the seed script.

## Setup

```bash
chmod +x examples/sandbox/seed.sh
./examples/sandbox/seed.sh
```

That creates a handful of empty directories so `search` and `path` have
something to find:

```
examples/sandbox/
├── forgemap.config.ts
├── comGithub/
│   ├── TitusKirch/{forgemap, envprism}
│   ├── kirchDev/{laravel-pbac, forgemap-php}
│   └── vercel/next.js
└── comGitlabExample/
    ├── team-platform/{api, web}
    └── team-data/etl
```

## Make the CLI runnable

Build once from the repo root, then either link globally so plain
`forgemap` works …

```bash
pnpm build
pnpm link --global       # → `forgemap` available everywhere
```

… or set a one-off alias for this shell:

```bash
alias forgemap='node /path/to/repo/dist/bin/forgemap.mjs'
```

Without either, invoke the built binary directly:

```bash
node ../../dist/bin/forgemap.mjs search forgemap
```

## Try it

From inside `examples/sandbox/` (so the walk-up config discovery picks
the local `forgemap.config.ts`):

```bash
cd examples/sandbox

forgemap config show

forgemap path kirchDev/laravel-pbac
forgemap path work:team-platform/api
forgemap path https://github.com/vercel/next.js

forgemap search forgemap          # matches both forgemap repos
forgemap search kirch             # matches kirchDev/*
forgemap search etl               # matches team-data/etl
forgemap search team --slug       # owner/repo output instead of paths
```

## Reset

```bash
rm -rf examples/sandbox/comGithub examples/sandbox/comGitlabExample
```
