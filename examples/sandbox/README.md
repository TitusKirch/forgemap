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

Pick one of the following depending on how much setup you want.

### Option 1: Global link + shell wrapper (recommended)

This gives you `forgemap` everywhere on `PATH`, plus `forgemap cd <slug>`
actually changing directory. Steps in [CONTRIBUTING.md → Trying the CLI
locally](../../CONTRIBUTING.md#trying-the-cli-locally); short form:

```bash
pnpm setup                     # one-time, then re-source ~/.zshrc
pnpm build
pnpm link --global .           # answer Y to the node_modules prompt
eval "$(forgemap shell-init)"  # add to ~/.zshrc for permanence
```

### Option 2: Direct invocation, no install

```bash
cd examples/sandbox
node ../../dist/bin/forgemap.mjs search forgemap
```

Works for every subcommand, but `cd` won't actually change directory
(that's the whole reason for shell-init — see the binary's error
message when you try it).

## Try it

From inside `examples/sandbox/` (so the walk-up config discovery picks
the local `forgemap.config.ts`):

```bash
cd examples/sandbox

forgemap config show
forgemap validate                  # preflight: schema, git/gh on PATH, root exists

forgemap path kirchDev/laravel-pbac
forgemap path vanilla:team-platform/api
forgemap path https://github.com/vercel/next.js

forgemap search forgemap           # matches both forgemap repos
forgemap search kirch              # matches kirchDev/*
forgemap search etl                # matches team-data/etl
forgemap search team --format slug

forgemap status                    # branch / dirty / ahead / behind / last commit
forgemap status --format json      # machine-readable
forgemap sync                      # git fetch in parallel; harmless on empty dirs

# With shell-init sourced:
forgemap cd laravel                # single match → cd straight in
forgemap cd kirch                  # multiple → picker
forgemap cd                        # no arg → picker over all repos
forgemap open kirchDev/forgemap-php   # opens in OS file manager

# git-type forge (vanilla) — these dirs are empty, but the URL builder works:
forgemap clone vanilla:foo/bar               # default SSH per forge config
forgemap clone --https vanilla:foo/bar       # override to HTTPS for this call
```

## Reset

```bash
rm -rf examples/sandbox/comGithub examples/sandbox/comGitlabExample
```
