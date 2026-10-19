/**
 * Parse an inbox index.json. The native extensions write the wrapped
 * form {"items": [...], "finished": bool} (see SharedVault.swift); a
 * bare array is also accepted. Unparseable input yields an empty index
 * instead of throwing — a corrupt inbox must never fail a drain.
 *
 * Kept dependency-free (like the other tested lib modules) so the pure
 * parsing is unit-testable; incoming.ts re-exports it alongside the
 * native-backed drain functions.
 */
export function parseInboxIndex(raw: string): {
  items: any[];
  finished: boolean;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { items: [], finished: false };
  }
  if (Array.isArray(parsed)) {
    return { items: parsed, finished: false };
  }
  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as { items?: unknown; finished?: unknown };
    return {
      items: Array.isArray(obj.items) ? obj.items : [],
      finished: obj.finished === true,
    };
  }
  return { items: [], finished: false };
}
