import { appendFile, mkdir, readFile } from 'node:fs/promises';
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
  | { status: 'present'; rcFile: string };

/**
 * Idempotently append a marker-guarded block of lines to the shell's rc file.
 * `label` namespaces the markers so independent features (the cd wrapper vs.
 * completion) don't clash. Returns whether it was added or already present.
 */
export async function installRcBlock(
  shell: Shell,
  label: string,
  lines: string[]
): Promise<InstallResult> {
  const rcFile = rcFileFor(shell);
  const marker = `# >>> forgemap ${label} >>>`;
  let existing = '';
  try {
    existing = await readFile(rcFile, 'utf8');
  } catch {
    // rc file doesn't exist yet — we'll create it.
  }
  if (existing.includes(marker)) {
    return { status: 'present', rcFile };
  }
  const block = `\n${marker}\n${lines.join('\n')}\n# <<< forgemap ${label} <<<\n`;
  await mkdir(dirname(rcFile), { recursive: true });
  await appendFile(rcFile, block, 'utf8');
  return { status: 'installed', rcFile };
}
