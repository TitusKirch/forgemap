import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'pathe';

export function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return p;
}

export function resolveRoot(root: string, configDir: string): string {
  const expanded = expandTilde(root);
  if (isAbsolute(expanded)) return expanded;
  return resolve(configDir, expanded);
}
