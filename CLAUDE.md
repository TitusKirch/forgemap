# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`forgemap` is a Node 24 / pnpm 11 CLI that manages a local repo layout of the form `~/projects/<gitserver>/<org-or-user>/<repo>`. First iteration sits on top of `gh` (GitHub CLI); later iterations may add native git or other forges (GitLab, Gitea, Codeberg).

Planned commands (roadmap; nothing implemented yet beyond bootstrap):

- `forgemap clone <slug>` — shells out to `gh repo clone`, places result under the configured root.
- `forgemap path <slug>` — resolves a slug like `kirchDev/laravel-pbac` to its local path.
- `forgemap sync` / `forgemap list` / `forgemap status` — future.

Config lives at `~/.config/forgemap/config.json` with shape `{ root: "~/projects", forges: [{ name, dir }] }`.

## Commands

| Command          | Purpose                                                          |
| :--------------- | :--------------------------------------------------------------- |
| `pnpm install`   | Install deps and wire husky hooks (`prepare` script runs husky). |
| `pnpm lint`      | `oxlint . --deny-warnings`                                       |
| `pnpm format`    | `oxfmt --check .`                                                |
| `pnpm check`     | `lint` + `format` — same gates as CI.                            |
| `pnpm check:fix` | Auto-fix lint + format.                                          |
| `pnpm taze`      | Show available dependency updates (`taze:w` to write).           |

There is no test runner wired up yet — add one in the PR that introduces the first command.

## House style — non-obvious bits

This repo mirrors the kirchDev scaffold (`../scaffold/`). Treat that repo as the source of truth for tooling drift — when bumping configs, diff against it first.

- **oxlint + oxfmt only.** No ESLint, no Prettier. Versions are pinned exactly (`oxlint 1.66.0`, `oxfmt 0.51.0`) — bump them deliberately, not via `^`.
- **Conventional Commits enforced.** Commitlint runs in the `commit-msg` hook. Use `feat:`, `fix:`, `chore:`, `docs:`, etc. Breaking changes: `feat!:` or `BREAKING CHANGE:` in the body.
- **Husky hooks are required.** Don't `--no-verify` unless explicitly asked. `pre-commit` runs lint-staged (oxlint + oxfmt on staged files); `commit-msg` runs commitlint.
- **`README.md` is excluded from oxfmt** (`.oxfmtrc.json` `ignorePatterns`). The kirchDev README house style relies on centered HTML blocks that the formatter would mangle — don't try to reformat it.
- **pnpm 11 with `node-linker=isolated`** and `prefer-frozen-lockfile=true` (see `.npmrc`). Always commit `pnpm-lock.yaml` changes.
- **`minimumReleaseAge=4320`** (3 days) in `.npmrc` — fresh package versions are blocked from install. If a new release is needed urgently, lower or override locally; don't change the global default.

## Releases

Automated via [release-please](https://github.com/googleapis/release-please) on push to `main`. `feat:`/`fix:` commits drive the next version; release-please opens a PR with the bump + CHANGELOG entry. Merging tags the release.

- `release-please-config.json` — `release-type: simple`, `include-v-in-tag: true`, pre-1.0 rules (`bump-minor-pre-major: true`, `bump-patch-for-minor-pre-major: false`).
- `.release-please-manifest.json` — current version source of truth. Keep in sync with `package.json` `version` when manually bumping.

## CI

- `ci.yml` — lint + format on PR (skips drafts).
- `codeql.yml` — JS/TS + GitHub Actions analysis, weekly + on push/PR touching `.js`/`.ts`/`.mjs`/`.cjs` or workflows.
- `release-please.yml` — runs on every push to `main`.

Dependabot groups npm patches/minors weekly and GitHub Actions monthly (`.github/dependabot.yml`).
