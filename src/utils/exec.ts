import { spawn } from 'node:child_process';

export interface ExecResult {
  code: number;
}

export function execInherit(
  command: string,
  args: string[]
): Promise<ExecResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 0 });
    });
  });
}

export interface CaptureResult {
  code: number;
  stdout: string;
  stderr: string;
  /** True when the process was killed because it exceeded `timeoutMs`. */
  timedOut?: boolean;
}

export interface CaptureOptions {
  cwd?: string;
  /** Kill the process after this many ms and resolve with `timedOut: true`. */
  timeoutMs?: number;
  /** Extra env vars, merged over `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export function execCapture(
  command: string,
  args: string[],
  options: CaptureOptions = {}
): Promise<CaptureResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : undefined,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    let timer: NodeJS.Timeout | undefined;
    let killer: NodeJS.Timeout | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // Escalate if it ignores SIGTERM (e.g. a wedged ssh child).
        killer = setTimeout(() => child.kill('SIGKILL'), 2000);
        killer.unref();
      }, options.timeoutMs);
      timer.unref();
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      if (killer) clearTimeout(killer);
      if (!settled) {
        settled = true;
        rejectPromise(error);
      }
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (killer) clearTimeout(killer);
      if (!settled) {
        settled = true;
        // A signal kill reports code null; surface a non-zero code so callers
        // that only inspect `code` don't mistake a timeout for success.
        resolvePromise({
          code: code ?? (timedOut ? 124 : 0),
          stdout,
          stderr,
          timedOut
        });
      }
    });
  });
}

export function hasCommand(command: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.platform === 'win32' ? 'where' : 'which',
      [command],
      {
        stdio: 'ignore'
      }
    );
    child.on('error', () => resolvePromise(false));
    child.on('close', (code) => resolvePromise(code === 0));
  });
}
