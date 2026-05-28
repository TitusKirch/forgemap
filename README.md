<div align="center">

# 🗺️ forgemap

**One consistent local layout for every repo you clone — across every forge**

[![npm Version](https://img.shields.io/npm/v/forgemap.svg?style=flat-square&color=4f46e5)](https://www.npmjs.com/package/forgemap)
[![Downloads](https://img.shields.io/npm/dm/forgemap.svg?style=flat-square&color=4f46e5)](https://www.npmjs.com/package/forgemap)
[![Tests](https://img.shields.io/github/actions/workflow/status/TitusKirch/forgemap/ci.yml?branch=main&style=flat-square&label=tests)](https://github.com/TitusKirch/forgemap/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/TitusKirch/forgemap?style=flat-square&color=10b981)](https://codecov.io/gh/TitusKirch/forgemap)
[![Node Version](https://img.shields.io/node/v/forgemap.svg?style=flat-square&color=8993be)](https://www.npmjs.com/package/forgemap)
[![License: MIT](https://img.shields.io/npm/l/forgemap.svg?style=flat-square&color=10b981)](LICENSE)

![forgemap demo](.github/assets/demo.gif)

</div>

---

```bash
$ forgemap clone kirchDev/laravel-pbac
✔ Cloned kirchDev/laravel-pbac → ~/projects/comGithub/kirchDev/laravel-pbac
```

That's it. Every repo lands at a predictable `<root>/<forge.dir>/<owner>/<repo>` path, and `forgemap cd <slug>` jumps into any of them from anywhere — exact slug, fuzzy match, or interactive picker.

## ✨ Features

- **🗂️ Predictable layout** — every clone goes to `<root>/<forge.dir>/<owner>/<repo>`, configured once.
- **🚪 Flexible slug syntax** — `owner/repo`, `forge:owner/repo`, full HTTPS URLs, or SSH (`git@…:…`).
- **🔍 Fuzzy search** — `forgemap search <term>` finds local repos by owner or repo name (powered by [Fuse.js](https://www.fusejs.io/)).
- **🤖 Forge-aware** — `type: 'github'` shells out to `gh`; `type: 'git'` uses plain `git clone` with no extra dependencies.
- **🔁 Mass sync + status** — `forgemap sync` fetches every clone in parallel, `forgemap status` shows branch / dirty / ahead / behind per repo.
- **📥 Import existing trees** — `forgemap import <path>` adopts a folder already laid out as `<server>/<owner>/<repo>`, reconciles each repo against its git remote (spotting moved or deleted remotes), and derives a config.
- **🧹 Safe cleanup** — `forgemap cleanup` deletes long-idle local clones, but only the ones that are clean, fully pushed, and still exist on their remote — so nothing unbacked-up is ever lost.
- **🛡️ Preflight validate** — `forgemap validate` checks the config schema and required CLIs before you discover a problem mid-clone.
- **🧰 Typed config** — `forgemap.config.ts` with `defineForgeMapConfig()`, parent walk-up discovery, and a global fallback.
- **🚀 Shell-friendly** — `forgemap shell-init --install` wires up real `forgemap cd <slug>` **and** tab-completion in one step.

## 📦 Installation

```bash
npm install -g forgemap
# or
pnpm add -g forgemap
```

**Requirements**

- Node 24+
- `git` on `PATH`
- [`gh`](https://cli.github.com/) (GitHub CLI) — only when a `type: 'github'` forge is configured

Run `forgemap validate` after setup for an exact rundown of what's needed for your config.

Hacking on forgemap itself? See [CONTRIBUTING.md → Trying the CLI locally](CONTRIBUTING.md#trying-the-cli-locally) — covers `pnpm setup`, `pnpm link --global .` and the shell-wrapper source.

## 🚀 Quick start

```bash
# 1. Pick a directory that should hold all your repos and drop a config there.
cd ~/projects
forgemap config init

# 2. Wire up the shell integration once — real `forgemap cd` + tab-completion.
forgemap shell-init --install            # appends loaders to ~/.zshrc (or bashrc/fish)
source ~/.zshrc                          # re-source once, then it's automatic
# Prefer manual? eval "$(forgemap shell-init)"   ·   fish: forgemap shell-init fish | source

# 3. Clone — any slug form works.
forgemap clone kirchDev/laravel-pbac
forgemap clone github:TitusKirch/forgemap
forgemap clone https://github.com/foo/bar

# 4. Jump into a repo from anywhere.
forgemap cd kirchDev/laravel-pbac        # exact slug → direct cd
forgemap cd laravel                      # fuzzy single match → direct cd
forgemap cd kirch                        # multiple matches → interactive picker
forgemap cd                              # no arg → picker over every clone
```

`forgemap cd` resolves the slug, walks/picks across your cloned repos,
and actually changes directory because the shell wrapper from
`shell-init` intercepts it before the binary runs. Every other
subcommand falls through to the real binary unchanged.

### Search and pick on demand

```bash
forgemap search forgemap            # pretty tree (one line per match)
forgemap search forgemap | fzf      # pipe-friendly path output
forgemap pick                       # interactive picker (consola prompt)
forgemap pick kirch                 # picker pre-filtered by fuzzy query
```

### Open the folder in the OS file manager

```bash
forgemap open kirchDev/laravel-pbac
```

- **WSL** → launches `explorer.exe` against `\\wsl$\<distro>\…`, Explorer opens the folder
- **macOS** → `open <path>` (Finder)
- **Linux** → `xdg-open <path>`

### Mass operations across every clone

```bash
forgemap sync                        # git fetch --all --prune, 4 in parallel
forgemap sync --pull                 # git pull --ff-only (skips dirty trees)
forgemap sync --forge work --query api  # restrict scope

forgemap status                      # tree: branch / dirty / ahead↑ / behind↓ / last commit
forgemap status --format json        # structured for jq + scripts
```

All tree output (`status`, `search`, `import`) groups as `forge → owner → repo`. Network operations (`sync`, `import`, `cleanup`) run with a hard timeout and non-interactive SSH, so an unreachable host can never wedge a run.

### Adopt an existing layout — `import`

Already have a folder full of repos laid out as `<server>/<owner>/<repo>`? Adopt it without re-cloning:

```bash
forgemap import ~/projects                  # reconcile + derive/write forgemap.config.ts
forgemap import ~/projects --no-remote-check # offline: folder-vs-origin only (instant)
forgemap import ~/projects --fix             # move folders / fix origin URLs to match the remote
forgemap import ~/projects --no-write-config # only report, don't touch the config
forgemap import ~/projects --format json
```

For each repo `import` compares the folder's `<owner>/<repo>` against the git `origin`, checks whether the remote still exists or was moved/renamed (GitHub via a batched `gh` GraphQL query, other forges via `git ls-remote`), and derives `root` + one forge per server directory. Read-only by default — `--fix` is the only thing that touches the filesystem.

### Reclaim disk — `cleanup`

```bash
forgemap cleanup                     # list deletable clones, then type "yes" to confirm
forgemap cleanup --dry-run           # show candidates + why every other idle repo is kept
forgemap cleanup --days 540          # idle threshold in days (default 365)
forgemap cleanup --include-dirty --include-unpushed   # also delete repos with local-only work (lost!)
```

A repo is only deleted when it is idle for `--days`+ days (by last **local** commit), has a clean working tree, has nothing unpushed, **and** its remote still exists — so everything removed is provably backed up. Repos without a remote (or with a gone/unreachable one) are never touched; empty owner directories left behind are pruned automatically. Deletion needs an explicit typed `yes` (or `--yes`).

### Preflight your config

```bash
forgemap validate                    # pretty checklist with ✓ / ! / ✗ per check
forgemap validate --json | jq        # machine-readable for pre-commit hooks
```

Validates the schema, required CLI tools (`git` always, `gh` when a `type: 'github'` forge is configured), `gh auth status`, and that the configured root exists.

### Shell integration & completion

```bash
forgemap shell-init --install        # cd wrapper + completion → your rc file (idempotent)
forgemap completion --install        # completion only, if you don't want the cd wrapper
forgemap shell-init                  # print the wrapper (manual: eval "$(…)")
forgemap completion bash             # print the completion script for bash/zsh/fish
```

`--install` appends a marker-guarded block to the right rc file (`~/.zshrc`, `~/.bashrc`, or `~/.config/fish/config.fish`) — re-source it once and you're done. Tab-completion suggests every subcommand, and slugs for the commands that take one (`cd`, `clone`, `open`, …).

### Inspect the config

```bash
forgemap config init                 # write a starter forgemap.config.ts
forgemap config show                 # print the resolved config + which file it came from
```

## ⚙️ Configuration

`forgemap config init` writes a `forgemap.config.ts` like this:

```ts
import { defineForgeMapConfig } from 'forgemap/config';

export default defineForgeMapConfig({
  root: '.',
  defaultForge: 'github',
  forges: {
    github: {
      type: 'github',          // uses `gh repo clone`
      host: 'github.com',
      dir: 'comGithub'
    },
    work: {
      type: 'git',             // plain `git clone` — no gh needed
      host: 'gitlab.acme.com',
      dir: 'comGitlabAcme',
      protocol: 'ssh'          // optional, ssh is the default
    }
  }
});
```

| Key                  | What it controls                                                                                          |
| :------------------- | :-------------------------------------------------------------------------------------------------------- |
| `root`               | Base directory for all clones. Relative paths resolve against the config file's directory.                |
| `defaultForge`       | Forge alias used when a slug is just `owner/repo` (no host or forge prefix).                              |
| `forges.<name>.type` | `'github'` (shells out to `gh`) or `'git'` (plain `git clone`). `gitlab` / `gitea` / `codeberg` reserved. |
| `forges.<name>.host` | Hostname used to map full URLs and (for `git`) build the clone URL.                                       |
| `forges.<name>.dir`  | Subdirectory under `root` where this forge's clones live.                                                 |
| `forges.<name>.protocol` | `git`-type only. `'ssh'` (default) or `'https'`. Override per call with `--ssh` / `--https`.          |

The config file is discovered by walking **up** from your current directory (so `forgemap cd` works from inside any clone, not just the root), then falling back to a global `$XDG_CONFIG_HOME/forgemap/forgemap.config.*` (i.e. `~/.config/forgemap/`) so commands work from anywhere. Override with `--config <path>` or the `FORGEMAP_CONFIG` env var.

> [!TIP]
> Already have a directory full of repos? Skip writing this by hand — `forgemap import <path>` derives `root` + `forges` from the existing layout.

## 🗂️ Layout

```
<root>/
└── <forge.dir>/
    └── <owner>/
        └── <repo>/
```

Example with the default config rooted at `~/projects`:

```
~/projects/
├── forgemap.config.ts
└── comGithub/
    ├── kirchDev/
    │   └── laravel-pbac/
    └── TitusKirch/
        └── forgemap/
```

## 🚪 Slug syntax

| Form                                | Resolves to                                            |
| :---------------------------------- | :----------------------------------------------------- |
| `kirchDev/laravel-pbac`             | Default forge, `kirchDev/laravel-pbac`.                |
| `work:team/api`                     | Named forge `work`, `team/api`.                        |
| `https://github.com/foo/bar`        | Host matched against `forges[].host`.                  |
| `https://github.com/foo/bar.git`    | Same, `.git` suffix stripped.                          |
| `git@github.com:foo/bar.git`        | SSH form, host matched against `forges[].host`.        |

## 🧪 Testing

```bash
pnpm install
pnpm test         # vitest
pnpm typecheck    # tsc --noEmit
pnpm check        # lint + format
pnpm bench        # microbench scanRepos / cache hit / cache rebuild
```

Tune the bench layout via env vars (`FORGEMAP_BENCH_FORGES`, `FORGEMAP_BENCH_OWNERS`, `FORGEMAP_BENCH_REPOS`, `FORGEMAP_BENCH_RUNS`).

## 🤝 Contributing

PRs welcome. Conventional Commits required (enforced via commitlint). Husky runs lint-staged on every commit.

> [!TIP]
> Run `pnpm check:fix` before pushing — CI will catch what husky missed.

## 🛣️ Versioning

[Semantic Versioning](https://semver.org/) via [release-please](https://github.com/googleapis/release-please) — see [CHANGELOG.md](CHANGELOG.md).

## 📄 License

[MIT](LICENSE) © [Titus Kirch](https://github.com/TitusKirch/) / [IT-Dienstleistungen Titus Kirch](https://kirch.dev)
