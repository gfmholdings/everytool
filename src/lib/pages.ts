// Page-range parsing for PDF tools. "1, 3, 5-7" → sorted unique 1-based
// page numbers, clamped to the document.

export function parsePageSpec(spec: string, maxPage: number): number[] {
  if (!Number.isSafeInteger(maxPage) || maxPage < 1) return [];
  const pages = new Set<number>();
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) continue;
      const start = Math.max(1, Math.min(a, b));
      const end = Math.min(maxPage, Math.max(a, b));
      for (let p = start; p <= end; p += 1) pages.add(p);
    } else if (/^\d+$/.test(trimmed)) {
      pages.add(Number(trimmed));
    }
  }
  return [...pages].filter((p) => p >= 1 && p <= maxPage).sort((x, y) => x - y);
}

/**
 * Resolve a spec against a page count for extraction. Returns 0-based
 * indices in the order the pages should appear (spec order is already
 * normalized to ascending by parsePageSpec).
 */
export function specToIndices(spec: string, maxPage: number): number[] {
  return parsePageSpec(spec, maxPage).map((p) => p - 1);
}
