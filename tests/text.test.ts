import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cleanUnit,
  countParagraphs,
  countSentences,
  countText,
  dedupeLines,
  dedupeText,
  describeText,
  extractEmails,
  extractLinks,
  extractNumbers,
  extractPhones,
  extractTags,
  findReplace,
  pluralWord,
  pullOut,
  readingTimeLabel,
  removeLineBreaks,
  reverseText,
  sortLines,
  sortText,
  toLowerCase,
  toSentenceCase,
  toTitleCase,
  toUpperCase,
  trimSpacing,
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

const OWNER = 'Yyyy hfc hfc';

test('owner input Yyyy hfc hfc dedupes as words and reports empty pulls', () => {
  // Line mode is the old silent no-op: one line has no duplicate line to drop.
  assert.equal(cleanUnit(OWNER), 'words');
  assert.equal(dedupeLines(OWNER), OWNER);
  assert.equal(sortLines(OWNER, 'asc'), OWNER);
  assert.equal(dedupeText(OWNER, 'lines'), OWNER);
  assert.equal(dedupeText(OWNER), 'Yyyy hfc');
  assert.equal(sortText(OWNER, 'asc'), 'hfc hfc Yyyy');
  assert.equal(sortText(OWNER, 'asc', 'lines'), OWNER);
  assert.equal(sortText(OWNER, 'desc'), OWNER);

  assert.equal(toUpperCase(OWNER), 'YYYY HFC HFC');
  assert.equal(toLowerCase(OWNER), 'yyyy hfc hfc');
  assert.equal(toTitleCase(OWNER), 'Yyyy Hfc Hfc');
  assert.equal(toSentenceCase(OWNER), OWNER);
  assert.equal(reverseText(OWNER), 'cfh cfh yyyY');
  assert.deepEqual(findReplace(OWNER, 'hfc', 'ok'), { text: 'Yyyy ok ok', count: 2 });
  assert.deepEqual(extractNumbers(OWNER), []);
  assert.deepEqual(extractTags(OWNER), []);

  for (const kind of ['links', 'emails', 'phones', 'numbers', 'tags'] as const) {
    const pulled = pullOut(kind, OWNER);
    assert.deepEqual(pulled.items, []);
    assert.match(pulled.empty, /^No /);
  }
  assert.equal(pullOut('links', OWNER).empty, 'No links found');

  const details = describeText(OWNER);
  assert.equal(details.words, 3);
  assert.equal(details.characters, 12);
  assert.equal(details.lines, 1);
  assert.equal(pluralWord(details.lines, 'line'), 'line');
  assert.equal(pluralWord(0, 'line'), 'lines');
  assert.equal(pluralWord(2, 'word'), 'words');
  assert.equal(details.sentences, 1);
  assert.equal(details.paragraphs, 1);
  assert.equal(details.readingTime, '< 1 min');
});

test('dedupeText and sortText honor an explicit unit', () => {
  assert.equal(cleanUnit('a\nb'), 'lines');
  assert.equal(cleanUnit('only\n\n'), 'words');
  assert.equal(dedupeText('hfc hfc\nhfc', 'words'), 'hfc');
  assert.equal(dedupeText('hfc hfc\nhfc', 'lines'), 'hfc hfc\nhfc');
  assert.equal(dedupeText('b\na\nb\nc\na\n', 'lines'), 'b\na\nc\n');
  assert.equal(sortText('Yyyy\nhfc', 'asc', 'words'), 'hfc Yyyy');
  assert.equal(sortText('Yyyy\nhfc', 'asc', 'lines'), 'hfc\nYyyy');
  assert.equal(dedupeText('Hfc hfc'), 'Hfc hfc');
});

test('case transforms', () => {
  assert.equal(toUpperCase("Don't stop"), "DON'T STOP");
  assert.equal(toLowerCase('Hello WORLD'), 'hello world');
  assert.equal(toTitleCase("don't STOP now"), "Don't Stop Now");
  assert.equal(toSentenceCase('HELLO WORLD. NEXT LINE!\nok?'), 'Hello world. Next line!\nOk?');
  assert.equal(toSentenceCase('123 abc'), '123 Abc');
});

test('trimSpacing drops extra spaces and empty lines', () => {
  assert.equal(trimSpacing('  Yyyy   hfc \t hfc  \n\n  c \t d  \n'), 'Yyyy hfc hfc\nc d');
  assert.equal(trimSpacing('already clean'), 'already clean');
  assert.equal(trimSpacing('\n\n'), '');
});

test('removeLineBreaks joins lines', () => {
  assert.equal(removeLineBreaks('Yyyy\nhfc\n\nhfc'), 'Yyyy hfc hfc');
  assert.equal(removeLineBreaks('a \n b'), 'a b');
});

test('findReplace is literal and skips an empty find', () => {
  assert.deepEqual(findReplace('abc', '', 'z'), { text: 'abc', count: 0 });
  assert.deepEqual(findReplace('aaa', 'aa', 'b'), { text: 'ba', count: 1 });
  assert.deepEqual(findReplace('a.b', '.', '-'), { text: 'a-b', count: 1 });
  assert.deepEqual(findReplace('Yyyy hfc hfc', 'zzz', 'ok'), { text: 'Yyyy hfc hfc', count: 0 });
});

test('reverseText reverses code points', () => {
  assert.equal(reverseText('Yyyy hfc hfc'), 'cfh cfh yyyY');
  assert.equal(reverseText('a😀b'), 'b😀a');
  assert.equal(reverseText(''), '');
});

test('extractNumbers keeps decimals, thousands, and first occurrence', () => {
  assert.deepEqual(extractNumbers('Order 12 and 12.50, then 1,000 and 12 again, code 007.'), [
    '12',
    '12.50',
    '1,000',
    '007',
  ]);
  assert.deepEqual(extractNumbers('Yyyy hfc hfc'), []);
});

test('extractTags keeps hashtags and mentions, skips emails', () => {
  assert.deepEqual(
    extractTags('hi #Hello #hello @Ada @Ada #ok and ada@example.com'),
    ['#Hello', '#hello', '@Ada', '#ok'],
  );
  assert.deepEqual(extractTags('Yyyy hfc hfc'), []);
});

test('sentences, paragraphs, and reading time', () => {
  assert.equal(countSentences(''), 0);
  assert.equal(countSentences('   '), 0);
  assert.equal(countSentences('Yyyy hfc hfc'), 1);
  assert.equal(countSentences('Hello. World! Yes?'), 3);
  assert.equal(countParagraphs(''), 0);
  assert.equal(countParagraphs('Yyyy hfc hfc'), 1);
  assert.equal(countParagraphs('a\nb'), 1);
  assert.equal(countParagraphs('a\n\nb\n\n\nc'), 3);
  assert.equal(readingTimeLabel(0), '0 min');
  assert.equal(readingTimeLabel(1), '< 1 min');
  assert.equal(readingTimeLabel(199), '< 1 min');
  assert.equal(readingTimeLabel(200), '1 min');
  assert.equal(readingTimeLabel(201), '2 min');
  assert.equal(describeText('').sentences, 0);
  assert.equal(describeText('').paragraphs, 0);
  assert.equal(describeText('').readingTime, '0 min');
});
