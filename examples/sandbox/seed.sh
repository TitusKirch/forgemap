#!/usr/bin/env bash
# Seed the sandbox with real (but local-only) git repos so every
# forgemap subcommand — status, sync, cd, search — has substantive
# data to report on. Each fake repo gets:
#
#   - `git init` with default branch 'main'
#   - a single README commit
#   - a no-op author config so commits succeed in CI containers too
#
# No remotes are added — fetch/pull will report "no remote", which is
# fine for a local-only sandbox.
set -euo pipefail

cd "$(dirname "$0")"

REPOS=(
  comGithub/TitusKirch/forgemap
  comGithub/TitusKirch/envprism
  comGithub/kirchDev/laravel-pbac
  comGithub/kirchDev/forgemap-php
  comGithub/vercel/next.js
  comGitlabExample/team-platform/api
  comGitlabExample/team-platform/web
  comGitlabExample/team-data/etl
)

init_repo() {
  local path="$1"
  if [ -d "$path/.git" ]; then
    return 0
  fi
  mkdir -p "$path"
  git -C "$path" init --quiet -b main
  git -C "$path" config user.email "sandbox@forgemap.local"
  git -C "$path" config user.name "Sandbox"
  git -C "$path" config commit.gpgsign false
  printf '# %s\n\nSandbox repo for forgemap demos.\n' "$(basename "$path")" \
    > "$path/README.md"
  git -C "$path" add README.md
  git -C "$path" commit --quiet -m 'init: seed sandbox repo'
}

for repo in "${REPOS[@]}"; do
  init_repo "$repo"
done

echo "Seeded ${#REPOS[@]} git repos in examples/sandbox/."
echo "Now try:"
echo "  cd examples/sandbox"
echo "  forgemap validate"
echo "  forgemap search forgemap"
echo "  forgemap status"
echo "  forgemap sync"
echo "  forgemap path vanilla:team-platform/api"
