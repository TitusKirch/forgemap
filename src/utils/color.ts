/**
 * Minimal ANSI helpers — no dependency. All functions return the input
 * untouched when stdout isn't a TTY, so piped output stays clean.
 */
const enabled = process.stdout.isTTY && !process.env.NO_COLOR;

export function bold(s: string): string {
  return enabled ? `\x1b[1m${s}\x1b[22m` : s;
}

export function dim(s: string): string {
  return enabled ? `\x1b[2m${s}\x1b[22m` : s;
}

export function cyan(s: string): string {
  return enabled ? `\x1b[36m${s}\x1b[39m` : s;
}

export function gray(s: string): string {
  return enabled ? `\x1b[90m${s}\x1b[39m` : s;
}

export const isInteractive = enabled;
