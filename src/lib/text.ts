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

export type CleanUnit = 'lines' | 'words';

/**
 * A single line has nothing for line-based dedupe or sort to change.
 * Treat that as words so "Yyyy hfc hfc" can drop the repeated word.
 */
export function cleanUnit(text: string): CleanUnit {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  return lines.length <= 1 ? 'words' : 'lines';
}

function wordsOf(text: string): string[] {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/) : [];
}

function dedupeWords(text: string): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const word of wordsOf(text)) {
    if (seen.has(word)) continue;
    seen.add(word);
    kept.push(word);
  }
  return kept.join(' ');
}

function sortWords(text: string, dir: 'asc' | 'desc'): string {
  const words = wordsOf(text);
  words.sort((a, b) => a.localeCompare(b));
  if (dir === 'desc') words.reverse();
  return words.join(' ');
}

/** Dedupe lines, or words when the text is a single line (or when asked). */
export function dedupeText(text: string, unit: CleanUnit = cleanUnit(text)): string {
  return unit === 'words' ? dedupeWords(text) : dedupeLines(text);
}

/** Sort lines, or words when the text is a single line (or when asked). */
export function sortText(
  text: string,
  dir: 'asc' | 'desc',
  unit: CleanUnit = cleanUnit(text),
): string {
  return unit === 'words' ? sortWords(text, dir) : sortLines(text, dir);
}

export function toUpperCase(text: string): string {
  return text.toUpperCase();
}

export function toLowerCase(text: string): string {
  return text.toLowerCase();
}

/** First letter of each word upper, the rest lower. "don't" stays "Don't". */
export function toTitleCase(text: string): string {
  return text.replace(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g, (word) => {
    const lower = word.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

/** Lowercase, then a capital after the start, a newline, or . ! ? */
export function toSentenceCase(text: string): string {
  const lower = text.toLowerCase();
  let cap = true;
  let out = '';
  for (const ch of lower) {
    if (cap && /[a-z]/.test(ch)) {
      out += ch.toUpperCase();
      cap = false;
    } else {
      out += ch;
    }
    if (ch === '\n' || ch === '.' || ch === '!' || ch === '?') cap = true;
  }
  return out;
}

/** Collapse spaces and tabs on each line, and drop lines that are empty. */
export function trimSpacing(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Join lines into one paragraph. */
export function removeLineBreaks(text: string): string {
  return text
    .replace(/[ \t]*\n+[ \t]*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Literal find and replace (not a regular expression).
 * An empty find is a no-op. The replacement is not searched again.
 */
export function findReplace(
  text: string,
  find: string,
  replacement: string,
): { text: string; count: number } {
  if (find === '') return { text, count: 0 };
  let count = 0;
  let start = 0;
  let out = '';
  while (start <= text.length) {
    const at = text.indexOf(find, start);
    if (at === -1) {
      out += text.slice(start);
      break;
    }
    out += text.slice(start, at) + replacement;
    count += 1;
    start = at + find.length;
  }
  return { text: out, count };
}

/** Reverse by code point, so an emoji stays one character. */
export function reverseText(text: string): string {
  return [...text].reverse().join('');
}

/** Numbers in order, decimals and thousands separators kept, duplicates dropped. */
export function extractNumbers(text: string): string[] {
  return uniqueMatches(text, /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g);
}

/**
 * Hashtags and @mentions. An email address is not a mention:
 * the @ in ada@example.com is skipped.
 */
export function extractTags(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/(?:^|[^\w.@%+-])([#@][A-Za-z0-9_]+)/g)) {
    const tag = match[1];
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

export type ExtractKind = 'links' | 'emails' | 'phones' | 'numbers' | 'tags';

export interface ExtractResult {
  title: string;
  items: string[];
  empty: string;
}

export function pullOut(kind: ExtractKind, text: string): ExtractResult {
  switch (kind) {
    case 'links':
      return { title: 'Links', items: extractLinks(text), empty: 'No links found' };
    case 'emails':
      return { title: 'Emails', items: extractEmails(text), empty: 'No emails found' };
    case 'phones':
      return {
        title: 'Phone numbers',
        items: extractPhones(text),
        empty: 'No phone numbers found',
      };
    case 'numbers':
      return { title: 'Numbers', items: extractNumbers(text), empty: 'No numbers found' };
    case 'tags':
      return {
        title: 'Hashtags & mentions',
        items: extractTags(text),
        empty: 'No hashtags or mentions found',
      };
  }
}

/** A fragment with no . ! ? still counts as one sentence. */
export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/[.!?]+/).filter((part) => part.trim().length > 0).length;
}

/** Paragraphs are blocks separated by a blank line. */
export function countParagraphs(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\n\s*\n/).filter((part) => part.trim().length > 0).length;
}

/** About 200 words a minute. Under that, and with at least one word, is "< 1 min". */
export function readingTimeLabel(words: number): string {
  if (words <= 0) return '0 min';
  if (words < 200) return '< 1 min';
  return `${Math.ceil(words / 200)} min`;
}

export function pluralWord(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

export interface TextDetails extends TextCounts {
  sentences: number;
  paragraphs: number;
  readingTime: string;
}

export function describeText(text: string): TextDetails {
  const counts = countText(text);
  return {
    ...counts,
    sentences: countSentences(text),
    paragraphs: countParagraphs(text),
    readingTime: readingTimeLabel(counts.words),
  };
}
