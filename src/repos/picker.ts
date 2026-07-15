import consola from 'consola';
import { colors } from 'consola/utils';
import type { ScannedRepo } from './scan.ts';

/**
 * Show the interactive repo picker and return the chosen local path
 * (undefined when the user cancels).
 *
 * `$(forgemap pick)` / `$(forgemap path <q>)` captures stdout, so the
 * interactive TUI must not go there. consola/clack writes the UI to stdout AND
 * reads stdout.rows/columns for layout — but a captured stdout is a pipe (no
 * rows → nothing renders). So for the duration of the prompt: route stdout
 * writes to stderr (the real TTY) and borrow stderr's dimensions, then
 * restore. stdout stays clean for the chosen path only.
 *
 * Callers must check {@link canPrompt} first — without a TTY on stdin there is
 * nobody to answer.
 */
export async function promptRepoChoice(
  candidates: ScannedRepo[]
): Promise<string | undefined> {
  const out = process.stdout;
  const realWrite = out.write;
  const saved = {
    rows: Object.getOwnPropertyDescriptor(out, 'rows'),
    columns: Object.getOwnPropertyDescriptor(out, 'columns'),
    isTTY: Object.getOwnPropertyDescriptor(out, 'isTTY')
  };
  const fake = (key: 'rows' | 'columns' | 'isTTY', value: unknown) => {
    Object.defineProperty(out, key, { configurable: true, value });
  };
  const restore = (key: 'rows' | 'columns' | 'isTTY') => {
    if (saved[key]) Object.defineProperty(out, key, saved[key]!);
    else delete (out as unknown as Record<string, unknown>)[key];
  };

  out.write = process.stderr.write.bind(process.stderr) as typeof out.write;
  fake('rows', process.stderr.rows ?? 24);
  fake('columns', process.stderr.columns ?? 80);
  fake('isTTY', true);

  let choice: unknown;
  try {
    choice = await consola.prompt('Select a repo', {
      type: 'select',
      options: candidates.map((r) => ({
        label: `${colors.gray(`${r.forgeName}:`)}${r.slug}`,
        value: r.localPath,
        hint: r.localPath
      }))
    });
  } finally {
    out.write = realWrite;
    restore('rows');
    restore('columns');
    restore('isTTY');
  }

  return typeof choice === 'string' && choice ? choice : undefined;
}

/** Whether an interactive prompt can be shown at all. */
export function canPrompt(): boolean {
  return Boolean(process.stdin.isTTY);
}
