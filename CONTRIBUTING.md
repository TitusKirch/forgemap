# Contributing to forgemap

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## Reporting issues

- **Questions, ideas, possible bugs**: the [Discord forum](https://discord.kirch.dev/).
- **Confirmed bugs**: a [Bug report](https://github.com/TitusKirch/forgemap/issues/new?template=bug_report.yml), with a minimal reproduction.
- **Features**: a [Feature request](https://github.com/TitusKirch/forgemap/issues/new?template=feature_request.yml).
- **Security vulnerabilities**: **never** a public issue — follow [SECURITY.md](SECURITY.md).

## Development setup

Requires Node **24+**, pnpm **12** and `git`; `gh` / `glab` for the forges that wrap them. After cloning, `pnpm install` wires the husky hooks.

The gate CI runs is `pnpm check && pnpm typecheck && pnpm test && pnpm build` — keep it green before you push; `pnpm check:fix` fixes lint and format.

### Trying the CLI locally

```bash
pnpm setup && source ~/.zshrc   # once: global bin on PATH (--force on an existing block)
pnpm build
pnpm link --global .            # the `.` is required
eval "$(forgemap shell-init)"   # fish: forgemap shell-init fish | source
```

`pnpm link` reinstalls `node_modules` from the lockfile — expected. After a code change, `pnpm build` is enough. Unlink with `pnpm uninstall -g forgemap`.

## Branching & PRs

1. Branch off `dev` and open the PR against `dev`. Never push to `main`.
2. Conventional Commits, enforced by commitlint. Mark a breaking change with `!` or a `BREAKING CHANGE:` footer.
3. One concern per PR.
4. Code changes need tests — a regression test for a fix, the happy path plus an edge case for a feature.
5. Changing a default? Update the README and the command's help text.

Husky lints and formats staged files on commit; if a hook fails, fix it and commit again — **no `--no-verify`** unless explicitly asked.

## AI agents

Agent guidance lives in [`AGENTS.md`](AGENTS.md). Claude Code (v2.1.277+) loads it only while no `CLAUDE.md` or `CLAUDE.local.md` sits in or above the working directory — don't add a `CLAUDE.md`.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
