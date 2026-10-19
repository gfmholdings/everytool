import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countText,
  dedupeLines,
  extractEmails,
  extractLinks,
  extractPhones,
  sortLines,
} from '../src/lib/text.ts';

test('extractLinks dedupes, keeps order, strips trailing punctuation', () => {
  const text =
    'See https://example.com/a. Then www.example.com/b, and https://example.com/a again. Try (https://x.io/path).';
  assert.deepEqual(extractLinks(text), [
    'https://example.com/a',
    'www.example.com/b',
    'https://x.io/path',
  ]);
});

test('extractEmails dedupes case-insensitively', () => {
  const text = 'Write Ana@Example.com or ana@example.com; bob@x.co.uk too.';
  assert.deepEqual(extractEmails(text), ['Ana@Example.com', 'bob@x.co.uk']);
});

test('extractPhones handles common formats, rejects tiny numbers', () => {
  const text =
    'Call (212) 555-0134 or +1 415-555-0100. Order #12345 is not a phone.';
  const phones = extractPhones(text);
  assert.deepEqual(phones, ['(212) 555-0134', '+1 415-555-0100']);
});

test('dedupeLines keeps first occurrence and order', () => {
  // A trailing newline survives (it is not a duplicate line).
  assert.equal(dedupeLines('b\na\nb\nc\na\n'), 'b\na\nc\n');
  assert.equal(dedupeLines(''), '');
});

test('sortLines both directions, case-insensitive', () => {
  assert.equal(sortLines('banana\nApple\ncherry', 'asc'), 'Apple\nbanana\ncherry');
  assert.equal(sortLines('banana\nApple\ncherry', 'desc'), 'cherry\nbanana\nApple');
});

test('countText', () => {
  const c = countText('one two\nthree');
  assert.equal(c.words, 3);
  assert.equal(c.lines, 2);
  assert.equal(c.characters, 13);
  assert.equal(countText('').words, 0);
});
