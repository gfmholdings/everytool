/** Read every page, rejecting a stalled cursor instead of looping forever. */
export async function collectPages<T>(
  fetchPage: (after?: string) => Promise<{ assets: T[]; hasNextPage: boolean; endCursor: string }>,
): Promise<T[]> {
  const result: T[] = [];
  const seen = new Set<string>();
  let after: string | undefined;
  for (;;) {
    const page = await fetchPage(after);
    result.push(...page.assets);
    if (!page.hasNextPage) return result;
    if (!page.endCursor || seen.has(page.endCursor)) throw new Error('Photos did not return the next page. Try again.');
    seen.add(page.endCursor);
    after = page.endCursor;
  }
}
