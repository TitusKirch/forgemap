#!/usr/bin/env bash
# Seed the sandbox with empty fake repo directories so `forgemap search`
# and `forgemap path` have something to work with — no network, no gh.
set -euo pipefail

cd "$(dirname "$0")"

mkdir -p \
  comGithub/TitusKirch/forgemap \
  comGithub/TitusKirch/envprism \
  comGithub/kirchDev/laravel-pbac \
  comGithub/kirchDev/forgemap-php \
  comGithub/vercel/next.js \
  comGitlabExample/team-platform/api \
  comGitlabExample/team-platform/web \
  comGitlabExample/team-data/etl

echo "Seeded fake repos in examples/sandbox/."
echo "Now try:"
echo "  cd examples/sandbox"
echo "  forgemap search forgemap"
echo "  forgemap search kirch"
echo "  forgemap path work:team-platform/api"
