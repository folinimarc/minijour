/** Limit network and memory pressure, and finish in-flight work before retrying. */
export async function downloadInParallel<T>(items: readonly T[], download: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  let failed = false;
  async function worker(): Promise<void> {
    while (!failed && next < items.length) {
      const item = items[next++];
      try { await download(item); }
      catch (error) { failed = true; throw error; }
    }
  }
  const results = await Promise.allSettled(Array.from({ length: Math.min(4, items.length) }, worker));
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
