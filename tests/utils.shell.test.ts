import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectShell } from '../src/utils/shell.ts';

describe('detectShell', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.SHELL;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.SHELL;
    else process.env.SHELL = saved;
  });

  it.each([
    ['/usr/bin/fish', 'fish'],
    ['/bin/bash', 'bash'],
    ['/bin/zsh', 'zsh'],
    // anything unrecognised falls back to zsh
    ['/bin/sh', 'zsh']
  ])('maps %s to %s', (shell, expected) => {
    process.env.SHELL = shell;
    expect(detectShell()).toBe(expected);
  });

  it('falls back to zsh when SHELL is unset', () => {
    delete process.env.SHELL;
    expect(detectShell()).toBe('zsh');
  });
});
