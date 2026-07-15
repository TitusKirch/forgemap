import { type ArgsDef, type CommandDef, runCommand } from 'citty';

/**
 * Why this exists.
 *
 * Injecting an `args` object straight into `command.run()` skips citty
 * entirely, so `node:util parseArgs` never runs and the test asserts against
 * a shape the command line can never actually produce. A flag can be
 * misnamed, unparsable or outright dead and an injected-args test still
 * passes — that is how `--filter a --filter b` silently collapsing to `'b'`
 * reached a release (TitusKirch/forgemap#44), and how `--no-cache` came to be
 * parsed as a negation of a `cache` flag that was never declared
 * (TitusKirch/forgemap#59).
 *
 * `runCli` drives a command the same way the binary does: raw argv in,
 * citty's real parsing, whatever the handler prints out.
 */

/** Redirect `process.stdout.write` into a buffer for the duration of a run. */
export function captureStdout(): { read: () => string; restore: () => void } {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  return {
    read: () => writes.join(''),
    restore: () => {
      process.stdout.write = original;
    }
  };
}

export interface CliRun {
  /** Everything the command wrote to stdout. */
  out: string;
  /** Non-empty stdout lines, which is what most assertions actually want. */
  lines: string[];
  /** `process.exitCode` as the command left it. */
  exit: number | undefined;
}

/**
 * Run `cmd` through citty's real argument parsing, capturing stdout and the
 * exit code. `rawArgs` is argv exactly as a user would type it.
 */
export async function runCli<T extends ArgsDef>(
  cmd: CommandDef<T>,
  rawArgs: string[]
): Promise<CliRun> {
  const stdout = captureStdout();
  process.exitCode = undefined;
  try {
    await runCommand(cmd, { rawArgs });
  } finally {
    stdout.restore();
  }
  const out = stdout.read();
  return {
    out,
    lines: out.split('\n').filter(Boolean),
    exit: process.exitCode
  };
}
