# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`forgemap` is a Node 24 / pnpm 11 CLI (built on [citty](https://github.com/unjs/citty)) that manages a local repo layout of the form `<root>/<forge.dir>/<owner>/<repo>`.

Commands are registered in `src/cli.ts` — treat that file as the list, not this one:

- **Acquire** — `clone`, `import` (adopt existing checkouts), `cleanup`, `delete`.
- **Locate** — `cd`, `path`, `open`, `list`, `pick` (fuzzy picker, `fuse.js`).
- **Inspect** — `status`, `sync`, `validate`.
- **Plumbing** — `completion`, `shell-init`, `config` (`init` / `show`).

`list` is the single command for both listing and searching — bare `list` prints every repo, `list <query>` fuzzy-matches. There is no separate `search` command (it was replaced by `list`).

Forge support is per-`type`, dispatched by `src/forges/registry.ts`:

- `github` — shells out to `gh` (clone + a batched GraphQL remote-identity check).
- `git` — vanilla `git clone`, ssh by default (`protocol: 'https'` to override).
- `gitlab` / `gitea` / `codeberg` — declared in `ForgeType`, **not implemented** — `getForgeAdapter` throws and points at `type: 'git'` as the fallback.

Config is loaded by [c12](https://github.com/unjs/c12) from `forgemap.config.{ts,mts,cts,js,mjs,cjs,json}` — resolution order: `--config` flag → `FORGEMAP_CONFIG` env → walk up from cwd → global `$XDG_CONFIG_HOME/forgemap` (or `~/.config/forgemap`). Shape is `{ root, defaultForge, forges: Record<string, { type, host, dir }> }` (`src/config/schema.ts`).

- **User-defined `forges` replace the defaults wholesale** — they are deliberately not deep-merged (`src/config/load.ts`). c12's `defaults:` would leak the built-in `github` forge into every custom layout and make `validate` demand `gh` when no github forge is configured.

## Commands

| Command          | Purpose                                                          |
| :--------------- | :--------------------------------------------------------------- |
| `pnpm install`   | Install deps and wire husky hooks (`prepare` script runs husky). |
| `pnpm build`     | `vite build` → `dist/` (`dev` rebuilds on watch).                |
| `pnpm lint`      | `oxlint . --deny-warnings`                                       |
| `pnpm format`    | `oxfmt --check .`                                                |
| `pnpm typecheck` | `tsc --noEmit`                                                   |
| `pnpm test`      | `vitest run` (`test:watch`, `test:coverage`).                    |
| `pnpm check`     | `lint` + `format`.                                               |
| `pnpm check:fix` | Auto-fix lint + format.                                          |
| `pnpm bench`     | Scan benchmark (`bench/scan.ts`).                                |
| `pnpm taze`      | Show available dependency updates (`taze:w` to write).           |

`pnpm check` is **not** the full CI gate — CI also runs `typecheck`, `test` and `build`. The full local equivalent is `pnpm check && pnpm typecheck && pnpm test && pnpm build`.

## House style — non-obvious bits

This repo mirrors the kirchDev scaffold (`../scaffold/`). Treat that repo as the source of truth for tooling drift — when bumping configs, diff against it first.

- **oxlint + oxfmt only.** No ESLint, no Prettier. Both are pinned exactly in `package.json` (no `^`) — bump them deliberately, and diff against the scaffold when you do.
- **oxfmt formats Markdown too**, `CLAUDE.md` included — a doc edit can fail `pnpm format`. Run `pnpm exec oxfmt <file>` after editing prose.
- **Conventional Commits enforced.** Commitlint runs in the `commit-msg` hook. Use `feat:`, `fix:`, `chore:`, `docs:`, etc. Breaking changes: `feat!:` or `BREAKING CHANGE:` in the body.
- **Husky hooks are required.** Don't `--no-verify` unless explicitly asked. `pre-commit` runs lint-staged (oxlint + oxfmt on staged files); `commit-msg` runs commitlint.
- **`README.md` is excluded from oxfmt** (`.oxfmtrc.json` `ignorePatterns`). The kirchDev README house style relies on centered HTML blocks that the formatter would mangle — don't try to reformat it.
- **pnpm settings live in `pnpm-workspace.yaml`, not `.npmrc`.** pnpm 10+ reads only auth/registry settings from `.npmrc`; everything else (`nodeLinker: isolated`, `preferFrozenLockfile: true`, …) is camelCase YAML in `pnpm-workspace.yaml`. Always commit `pnpm-lock.yaml` changes.
- **`minimumReleaseAge: 4320`** (3 days) in `pnpm-workspace.yaml` — fresh package versions are blocked from install. If a new release is needed urgently, lower or override locally; don't change the global default.
- **Vitest config lives in `vite.config.ts`** (the `test` key), not a separate `vitest.config.ts`. Tests live in `tests/`, mirroring `src/` — not colocated. Coverage thresholds are enforced there and **fail the run**, so a new `src/` file generally needs tests.

## Releases

Automated via [release-please](https://github.com/googleapis/release-please) on push to `main`. `feat:`/`fix:` commits drive the next version; release-please opens a PR with the bump + CHANGELOG entry. Merging tags the release.

- `release-please-config.json` — `release-type: node`, `include-v-in-tag: true`, pre-1.0 rules (`bump-minor-pre-major: true`, `bump-patch-for-minor-pre-major: false`).
- `.release-please-manifest.json` — current version source of truth. Keep in sync with `package.json` `version` when manually bumping.
- **`dev` is the integration branch.** Work lands on `dev`; `dev-pr.yml` keeps a draft `dev → main` rollup PR open. Merge it with a **merge commit, not squash** — squashing hides the individual `feat:`/`fix:` commits from release-please.

## CI

- `ci.yml` — four parallel jobs on PR to `main`/`dev` (skips drafts): **Lint & Format**, **Typecheck**, **Test**, **Build**. The Test job runs `pnpm test:coverage` and posts a sticky coverage comment; the coverage gate itself is vitest's `thresholds`, not the action.
- `codeql.yml` — `javascript-typescript` + `actions` analysis, weekly (Sun 23:34 UTC) + on every push/PR to `main`/`dev` (no path filter) + `workflow_dispatch`.
- `release-please.yml` — triggers on push to `main`/`dev`, but the job is gated `if: github.ref_name == 'main'`, so only `main` releases. Publishes with a GitHub App token minted from a Bitwarden-held PEM.
- `dev-pr.yml` — on push to `dev`, opens/refreshes the draft `dev → main` rollup PR.

Dependabot groups npm patches/minors weekly and GitHub Actions monthly, targets **`dev`** (not `main`), and mirrors the 3-day `minimumReleaseAge` via `cooldown` (`.github/dependabot.yml`).
