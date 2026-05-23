/**
 * Map over `items` running at most `limit` calls of `fn` at once, preserving
 * input order in the result. Keeps `import` from spawning one subprocess per
 * repo all at once when checking remotes across a large tree.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  const max = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: max }, () => worker()));
  return results;
}
