# forgemap

Node 24 / pnpm 12 CLI ([citty](https://github.com/unjs/citty)) managing a local layout `<root>/<forge.dir>/<namespace…>/<repo>`.

## Layout rules

- **The namespace is variable-depth.** `src/repos/layout.ts` alone bounds it (`MAX_SCAN_DEPTH`, the `.git` marker, per-forge-type depth); scan, cache, evaluate and `src/slug/resolve.ts` read it — never re-encode a depth.
- **A directory holding a `.git` entry (file or directory) is a repo.** The scan stops at the first marker and never descends into a repo; a plain directory under a forge dir is not a repo — `validate` reports it as a hint.
- **`parseSlug` stays pure.** Depth is checked against the forge type in `resolveSlug` — `github` still rejects `a/b/c`.

## Commands and forges

- `src/cli.ts` is the command list. `list` is listing and search in one — don't add a `search` command. `move --agents` carries Claude Code / Codex session state via `src/agents/`.
- Forges dispatch per `type` in `src/forges/registry.ts`:
  - `github` → `gh`; `gitlab` → `glab`, **required, never a silent git fallback**, every call sets `GITLAB_HOST=<forge.host>`.
  - `git` → plain `git clone`, ssh unless `protocol: 'https'`; the fallback for GitLab-shaped remotes without `glab`.
  - `gitea` / `codeberg` are typed but unimplemented — `getForgeAdapter` throws and points at `type: 'git'`.

## Config

Loaded by [c12](https://github.com/unjs/c12) (`src/config/load.ts`): `--config` → `FORGEMAP_CONFIG` → walk-up from cwd → `$XDG_CONFIG_HOME/forgemap`. Shape: `src/config/schema.ts`.

- **User `forges` replace the defaults wholesale — never deep-merge**, or the built-in `github` forge leaks in and `validate` demands `gh`.

## Gate

`pnpm check && pnpm typecheck && pnpm test && pnpm build` — `pnpm check` (lint + format) alone is not what CI runs. Scripts: `package.json`.

## House style

Tooling mirrors the kirchDev scaffold (`../scaffold/`) — diff against it before bumping configs.

- **oxlint + oxfmt only**, both pinned exactly; bump deliberately.
- **oxfmt formats Markdown** — run `pnpm exec oxfmt <file>` after editing prose. `README.md` and `AGENTS.md` are free-form prose and excluded (`.oxfmtrc.json`, `lint-staged.config.ts`); don't reformat them.
- **Conventional Commits** via commitlint, breaking changes with `!` or `BREAKING CHANGE:`; husky hooks are required — no `--no-verify` unless asked.
- **pnpm settings live in `pnpm-workspace.yaml`**, not `.npmrc`. Commit `pnpm-lock.yaml` changes.
- **`minimumReleaseAge: 4320`** blocks fresh versions — override locally if urgent, never change the default.
- **Vitest config is in `vite.config.ts`.** Tests live in `tests/`, mirroring `src/`. Coverage thresholds fail the run, so a new `src/` file needs tests.

## Releases and CI

- **`dev` is the integration branch**; `promotion-pr.yml` keeps the `dev → main` PR open. Merge it with a **merge commit, never squash** — release-please needs the individual `feat:`/`fix:` commits.
- release-please runs on `main` only and publishes to npm (`release-please.yml`, `release-please-config.json`). Keep `.release-please-manifest.json` and `package.json` `version` in sync on a manual bump.
- Workflows call pinned reusable workflows from `kirchDev/workflows` (`.github/workflows/`).
- Dependabot targets **`dev`**, with a 3-day cooldown matching the release-age gate (`.github/dependabot.yml`).
