# VHS image for rendering the README demo GIF, fully headless.
#
# Build:  docker build -f .github/assets/vhs.Dockerfile -t forgemap-vhs .
# Render: docker run --rm -v "$PWD:/vhs" forgemap-vhs .github/assets/demo.tape
#
# The official VHS image renders without a TTY/Homebrew/OBS — ideal for CI and
# WSL/root environments. It ships ffmpeg but NOT Node or git, both of which
# forgemap needs at render time. forgemap is a plain Node CLI (no Bun).
FROM ghcr.io/charmbracelet/vhs

# git: the tape seeds local repos and `forgemap status` reads branch / dirty /
#      ahead-behind / last-commit via git per repo.
# node: forgemap requires Node 24+ (engines field). The base image ships no
#       Node, so install the official static build (pinned, matches engines).
ARG NODE_VERSION=24.12.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends git curl ca-certificates xz-utils \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
     | tar -xJ -C /usr/local --strip-components=1 \
  && node --version
