import { describe, expect, it } from 'vitest';
import { execInherit, hasCommand } from '../src/utils/exec.ts';

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
