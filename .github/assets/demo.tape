# forgemap README demo — rendered with VHS (https://github.com/charmbracelet/vhs)
#
# Regenerate (no local install needed, Docker only):
#   pnpm build
#   docker build -f .github/assets/vhs.Dockerfile -t forgemap-vhs .
#   docker run --rm -v "$PWD:/vhs" forgemap-vhs .github/assets/demo.tape
#
# The tape is the source of truth — edit the choreography below, re-run, commit
# the new GIF. Never hand-edit the GIF.

# Output MUST be a relative path — VHS rejects absolute paths like /vhs/...
Output .github/assets/demo.gif

Set Shell bash
Set FontSize 16
Set Width 1280
Set Height 720
Set Padding 16
# Cap capture rate so a busy repaint can't drop frames and speed up playback.
Set Framerate 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms

# --- setup (hidden): seed a throwaway repo layout under ~/projects, install the
#     BUILT forgemap on PATH, and source the real shell integration so
#     `forgemap cd` actually changes directory. Fully reproducible, no host state.
#     The shim is base64 so the tape needs no nested quoting. ---
Hide
# Dynamic prompt: \w shows the cwd, so every `cd` visibly moves us.
Type `export PS1='\w $ '`
Enter
# Real `forgemap` on PATH — the shell wrapper calls `command forgemap` for its
# search/pick subcalls, which skips shell functions, so a PATH binary is needed.
Type "echo IyEvYmluL3NoCmV4ZWMgbm9kZSAvdmhzL2Rpc3QvYmluL2ZvcmdlbWFwLm1qcyAiJEAiCg== | base64 -d > /usr/local/bin/forgemap && chmod +x /usr/local/bin/forgemap"
Enter
Type "mkdir -p ~/projects && cp /vhs/examples/sandbox/forgemap.config.ts /vhs/examples/sandbox/seed.sh ~/projects/"
Enter
Type "cd ~/projects && bash seed.sh >/dev/null 2>&1"
Enter
Sleep 3s
# Source the wrapper: now `forgemap cd <slug>` is a real cd in this shell.
Type `eval "$(forgemap shell-init bash)"`
Enter
Type "clear"
Enter
Show

# --- clean prompt is up at ~/projects ---
Sleep 1s

# 1. The whole layout at a glance: branch / clean / last commit per repo.
Type "forgemap status"
Sleep 400ms
Enter
Sleep 3.5s

# 2. Fuzzy slug → a single match cd's straight in. Watch the prompt jump
#    to the full <root>/<forge.dir>/<owner>/<repo> path.
Type "forgemap cd laravel"
Sleep 400ms
Enter
Sleep 2.8s

# 3. No argument → interactive picker over every cloned repo. Arrow down,
#    hit enter, and you're there — from anywhere.
Type "forgemap cd"
Sleep 400ms
Enter
Sleep 1.4s
Down@450ms 4
Sleep 900ms
Enter
Sleep 3s

# --- end on the new repo dir in the prompt; no quit key (that would film the
#     shell teardown). VHS kills the process at tape end → clean final frame. ---
Sleep 1s
