// Text tools: counts, extraction, line cleanup. Extraction is deduped
// (first occurrence wins, order preserved) — a pasted thread that quotes
// the same address five times shows it once.

export interface TextCounts {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  lines: number;
}

export function countText(text: string): TextCounts {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return {
    words,
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
    lines: text ? text.split('\n').length : 0,
  };
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  const found = text.match(pattern) ?? [];
  return [...new Set(found)];
}

export function extractLinks(text: string): string[] {
  const raw = uniqueMatches(text, /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi);
  // A link at the end of a sentence keeps its full stop without this trim.
  return [...new Set(raw.map((l) => l.replace(/[.,;:!?]+$/, '')))];
}

export function extractEmails(text: string): string[] {
  // Case-insensitive dedupe: Ana@x and ana@x are the same mailbox.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const email of text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) ?? []) {
    const key = email.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(email);
    }
  }
  return out;
}

export function extractPhones(text: string): string[] {
  return uniqueMatches(
    text,
    /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g,
  );
}

/** Remove duplicate lines (compared trimmed; first occurrence kept verbatim). */
export function dedupeLines(text: string): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    const key = line.trim();
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(line);
    }
  }
  return kept.join('\n');
}

/** Sort the non-empty lines; blank lines are dropped (matches the mockup). */
export function sortLines(text: string, dir: 'asc' | 'desc'): string {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  lines.sort((a, b) => a.localeCompare(b));
  if (dir === 'desc') lines.reverse();
  return lines.join('\n');
}
