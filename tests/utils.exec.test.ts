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
