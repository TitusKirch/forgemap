<div align="center">

# 🧰 forgemap

**One consistent local layout for every repo you clone — across every forge**

[![npm Version](https://img.shields.io/npm/v/forgemap.svg?style=flat-square&color=4f46e5)](https://www.npmjs.com/package/forgemap)
[![Downloads](https://img.shields.io/npm/dm/forgemap.svg?style=flat-square&color=4f46e5)](https://www.npmjs.com/package/forgemap)
[![Tests](https://img.shields.io/github/actions/workflow/status/TitusKirch/forgemap/ci.yml?branch=main&style=flat-square&label=tests)](https://github.com/TitusKirch/forgemap/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/TitusKirch/forgemap?style=flat-square&color=10b981)](https://codecov.io/gh/TitusKirch/forgemap)
[![Node Version](https://img.shields.io/node/v/forgemap.svg?style=flat-square&color=8993be)](https://www.npmjs.com/package/forgemap)
[![License: MIT](https://img.shields.io/npm/l/forgemap.svg?style=flat-square&color=10b981)](LICENSE)

</div>

---

```bash
$ forgemap clone kirchDev/laravel-pbac
✔ Cloned kirchDev/laravel-pbac → ~/projects/comGithub/kirchDev/laravel-pbac
```

That's it. Every repo lands at a predictable `<root>/<forge.dir>/<owner>/<repo>` path, and `forgemap path <slug>` gives you that path back for `cd "$(forgemap path …)"` from anywhere.

## ✨ Features

- **🗂️ Predictable layout** — every clone goes to `<root>/<forge.dir>/<owner>/<repo>`, configured once.
- **🚪 Flexible slug syntax** — `owner/repo`, `forge:owner/repo`, full HTTPS URLs, or SSH (`git@…:…`).
- **🔍 Fuzzy search** — `forgemap search <term>` finds local repos by owner or repo name (powered by [Fuse.js](https://www.fusejs.io/)).
- **🤖 Forge-aware** — `type: 'github'` shells out to `gh`; `type: 'git'` uses plain `git clone` with no extra dependencies.
- **🔁 Mass sync + status** — `forgemap sync` fetches every clone in parallel, `forgemap status` shows branch / dirty / ahead / behind per repo.
- **🛡️ Preflight validate** — `forgemap validate` checks the config schema and required CLIs before you discover a problem mid-clone.
- **🧰 Typed config** — `forgemap.config.ts` with `defineForgeMapConfig()` and walk-up discovery.
- **🚀 Shell-friendly** — `forgemap cd <slug>` (via `shell-init`) actually changes directory.

## 📦 Installation

```bash
npm install -g forgemap
# or
pnpm add -g forgemap
```

> [!IMPORTANT]
> `forgemap clone` shells out to the [GitHub CLI](https://cli.github.com/) (`gh`). Install it once and run `gh auth login` so cloning works against private repos.

> [!TIP]
> Hacking on forgemap itself? See [CONTRIBUTING.md → Trying the CLI locally](CONTRIBUTING.md#trying-the-cli-locally) — covers `pnpm setup`, `pnpm link --global .` and the shell-wrapper source.

## 🚀 Quick start

```bash
# 1. Pick a directory that should hold all your repos and drop a config there.
cd ~/projects
forgemap config init

# 2. Clone — any slug form works.
forgemap clone kirchDev/laravel-pbac
forgemap clone github:TitusKirch/forgemap
forgemap clone https://github.com/foo/bar

# 3. Jump into a repo from anywhere.
cd "$(forgemap path kirchDev/laravel-pbac)"
```

Add a shell alias to make the jump even shorter:

```bash
fcd() { cd "$(forgemap path "$1")"; }
fcd kirchDev/laravel-pbac
```

### Real `cd` via shell integration (recommended)

Source the shell wrapper once:

```bash
# zsh/bash — drop into ~/.zshrc or ~/.bashrc
eval "$(forgemap shell-init)"

# fish
forgemap shell-init fish | source
```

After that, `forgemap cd <slug>` actually changes directory:

```bash
forgemap cd laravel      # cd straight into kirchDev/laravel-pbac (single match)
forgemap cd kirch        # multiple matches → interactive picker
forgemap cd              # no arg → picker over every cloned repo
```

All other `forgemap` subcommands pass through to the real binary unchanged.

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

### Preflight your config

```bash
forgemap validate                    # pretty checklist with ✓ / ! / ✗ per check
forgemap validate --json | jq        # machine-readable for pre-commit hooks
```

Validates the schema, required CLI tools (`git` always, `gh` when a `type: 'github'` forge is configured), `gh auth status`, and that the configured root exists.

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

The config file is discovered by walking up from your current directory. Override with `--config <path>` or the `FORGEMAP_CONFIG` env var.

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
```

## 🤝 Contributing

PRs welcome. Conventional Commits required (enforced via commitlint). Husky runs lint-staged on every commit.

> [!TIP]
> Run `pnpm check:fix` before pushing — CI will catch what husky missed.

## 🛣️ Versioning

[Semantic Versioning](https://semver.org/) via [release-please](https://github.com/googleapis/release-please) — see [CHANGELOG.md](CHANGELOG.md).

## 📄 License

[MIT](LICENSE) © [Titus Kirch](https://github.com/TitusKirch/) / [IT-Dienstleistungen Titus Kirch](https://kirch.dev)
