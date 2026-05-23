import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'pathe';

export type Shell = 'zsh' | 'bash' | 'fish';

export const SUPPORTED_SHELLS: Shell[] = ['zsh', 'bash', 'fish'];

export function detectShell(): Shell {
  const env = process.env.SHELL ?? '';
  if (env.endsWith('/fish')) return 'fish';
  if (env.endsWith('/bash')) return 'bash';
  return 'zsh';
}

export function rcFileFor(shell: Shell): string {
  const home = homedir();
  if (shell === 'fish') return join(home, '.config', 'fish', 'config.fish');
  if (shell === 'bash') return join(home, '.bashrc');
  return join(home, '.zshrc');
}

export type InstallResult =
  | { status: 'installed'; rcFile: string }
  | { status: 'updated'; rcFile: string }
  | { status: 'present'; rcFile: string };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip every marker-guarded block for any of `labels` from `content`. */
function stripBlocks(content: string, labels: string[]): string {
  let out = content;
  for (const label of labels) {
    const l = escapeRegExp(label);
    const re = new RegExp(
      `\\n*# >>> forgemap ${l} >>>[\\s\\S]*?# <<< forgemap ${l} <<<\\n?`,
      'g'
    );
    out = out.replace(re, '');
  }
  return out;
}

/**
 * Install a marker-guarded block of lines into the shell's rc file. `label`
 * namespaces the markers so independent features don't clash; `legacyLabels`
 * are older labels this feature used to write — they're removed too, so a
 * label rename never leaves a stale duplicate behind. Idempotent: re-running
 * collapses any existing/legacy blocks into a single current one.
 */
export async function installRcBlock(
  shell: Shell,
  label: string,
  lines: string[],
  legacyLabels: string[] = []
): Promise<InstallResult> {
  const rcFile = rcFileFor(shell);
  let existing = '';
  try {
    existing = await readFile(rcFile, 'utf8');
  } catch {
    // rc file doesn't exist yet — we'll create it.
  }

  const allLabels = [label, ...legacyLabels];
  const hadAny = allLabels.some((l) =>
    existing.includes(`# >>> forgemap ${l} >>>`)
  );

  const block = `# >>> forgemap ${label} >>>\n${lines.join('\n')}\n# <<< forgemap ${label} <<<\n`;
  const cleaned = stripBlocks(existing, allLabels).replace(/\s*$/, '');
  const next = cleaned.length > 0 ? `${cleaned}\n\n${block}` : block;

  if (next === existing) {
    return { status: 'present', rcFile };
  }
  await mkdir(dirname(rcFile), { recursive: true });
  await writeFile(rcFile, next, 'utf8');
  return { status: hadAny ? 'updated' : 'installed', rcFile };
}
