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
