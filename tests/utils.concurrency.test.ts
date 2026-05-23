import { describe, expect, it } from 'vitest';
import { mapLimit } from '../src/utils/concurrency.ts';

describe('mapLimit', () => {
  it('preserves input order', async () => {
    const out = await mapLimit([10, 20, 30], 2, async (n) => n * 2);
    expect(out).toEqual([20, 40, 60]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await mapLimit(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async (n) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 1));
        active--;
        return n;
      }
    );
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async (n) => n)).toEqual([]);
  });

  it('passes the index', async () => {
    const out = await mapLimit(['a', 'b', 'c'], 1, async (_, i) => i);
    expect(out).toEqual([0, 1, 2]);
  });
});
