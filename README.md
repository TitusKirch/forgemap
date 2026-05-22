<div align="center">

# 🧰 forgemap

**One consistent local layout for every repo you clone — across every forge**

[![npm Version](https://img.shields.io/npm/v/forgemap.svg?style=flat-square&color=4f46e5)](https://www.npmjs.com/package/forgemap)
[![Downloads](https://img.shields.io/npm/dm/forgemap.svg?style=flat-square&color=4f46e5)](https://www.npmjs.com/package/forgemap)
[![Tests](https://img.shields.io/github/actions/workflow/status/TitusKirch/forgemap/ci.yml?branch=main&style=flat-square&label=tests)](https://github.com/TitusKirch/forgemap/actions/workflows/ci.yml)
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
- **🤖 Forge-aware** — uses `gh` for GitHub today; GitLab / Gitea / Codeberg adapters planned.
- **🧰 Typed config** — `forgemap.config.ts` with `defineForgeMapConfig()` and walk-up discovery.
- **🚀 Shell-friendly** — `forgemap path <slug>` is a pure resolver, perfect for `cd "$(…)"` aliases.

## 📦 Installation

```bash
npm install -g forgemap
# or
pnpm add -g forgemap
```

> [!IMPORTANT]
> `forgemap clone` shells out to the [GitHub CLI](https://cli.github.com/) (`gh`). Install it once and run `gh auth login` so cloning works against private repos.

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

## ⚙️ Configuration

`forgemap config init` writes a `forgemap.config.ts` like this:

```ts
import { defineForgeMapConfig } from 'forgemap/config';

export default defineForgeMapConfig({
  root: '.',
  defaultForge: 'github',
  forges: {
    github: {
      type: 'github',
      host: 'github.com',
      dir: 'comGithub'
    },
    work: {
      type: 'gitlab',
      host: 'gitlab.acme.com',
      dir: 'comGitlabAcme'
    }
  }
});
```

| Key            | What it controls                                                                                |
| :------------- | :---------------------------------------------------------------------------------------------- |
| `root`         | Base directory for all clones. Relative paths resolve against the config file's directory.      |
| `defaultForge` | Forge alias used when a slug is just `owner/repo` (no host or forge prefix).                    |
| `forges.<name>` | Map of forge aliases. Each entry has `type`, `host`, and `dir` (subdirectory under `root`).    |

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
