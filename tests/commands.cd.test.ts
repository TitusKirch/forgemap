import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cdCommand } from '../src/commands/cd.ts';

describe('cdCommand', () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('exits 1 with an instruction when invoked directly', async () => {
    await cdCommand.run!({
      args: { _: [] },
      rawArgs: [],
      cmd: cdCommand,
      data: undefined
    } as never);
    expect(process.exitCode).toBe(1);
  });
});
