import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isWsl, toFileUrl } from '../src/utils/wsl.ts';

describe('toFileUrl', () => {
  let originalDistro: string | undefined;

  beforeEach(() => {
    originalDistro = process.env.WSL_DISTRO_NAME;
  });

  afterEach(() => {
    if (originalDistro === undefined) delete process.env.WSL_DISTRO_NAME;
    else process.env.WSL_DISTRO_NAME = originalDistro;
  });

  it('returns plain file:// outside WSL', () => {
    delete process.env.WSL_DISTRO_NAME;
    expect(toFileUrl('/root/foo')).toBe('file:///root/foo');
    expect(isWsl()).toBe(false);
  });

  it('rewrites paths into the UNC form on WSL', () => {
    process.env.WSL_DISTRO_NAME = 'Ubuntu';
    expect(toFileUrl('/root/projects/foo')).toBe(
      'file:////wsl$/Ubuntu/root/projects/foo'
    );
    expect(isWsl()).toBe(true);
  });
});
