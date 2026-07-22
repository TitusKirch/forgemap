import { describe, expect, it } from 'vitest';
import { execCapture, execInherit, hasCommand } from '../src/utils/exec.ts';

describe('hasCommand', () => {
  it('returns true for node (always present in CI)', async () => {
    await expect(hasCommand('node')).resolves.toBe(true);
  });

  it('returns false for a guaranteed-missing binary', async () => {
    await expect(
      hasCommand('forgemap-definitely-not-installed-xyz')
    ).resolves.toBe(false);
  });
});

describe('execInherit', () => {
  it('returns { code: 0 } for a successful command', async () => {
    const result = await execInherit('node', ['--version']);
    expect(result.code).toBe(0);
  });

  it('returns a non-zero code when the command fails', async () => {
    const result = await execInherit('node', ['-e', 'process.exit(42)']);
    expect(result.code).toBe(42);
  });
});

describe('execCapture', () => {
  it('captures stdout and exit code', async () => {
    const result = await execCapture('node', [
      '-e',
      'process.stdout.write("hi")'
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('hi');
    expect(result.timedOut).toBeFalsy();
  });

  it('kills the process and flags timedOut when it exceeds timeoutMs', async () => {
    const result = await execCapture(
      'node',
      ['-e', 'setTimeout(() => {}, 10000)'],
      { timeoutMs: 100 }
    );
    expect(result.timedOut).toBe(true);
    expect(result.code).not.toBe(0);
  });
});

describe('exec edge cases', () => {
  it('hasCommand uses `where` on win32', async () => {
    const saved = process.platform;
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true
    });
    try {
      // `where` does not exist on Linux, so the spawn errors out and the
      // promise resolves false — which is the branch under test.
      await expect(hasCommand('node')).resolves.toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', {
        value: saved,
        configurable: true
      });
    }
  });

  it('execCapture rejects when the binary is missing and no timeout is set', async () => {
    await expect(
      execCapture('forgemap-definitely-not-installed-xyz', [])
    ).rejects.toThrow();
  });

  it('execCapture reports code 0 for a signal kill that was not a timeout', async () => {
    const result = await execCapture('node', [
      '-e',
      'process.kill(process.pid, "SIGTERM")'
    ]);
    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('execInherit reports code 0 for a signal kill', async () => {
    const result = await execInherit('node', [
      '-e',
      'process.kill(process.pid, "SIGTERM")'
    ]);
    expect(result.code).toBe(0);
  });
});
