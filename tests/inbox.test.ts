import assert from 'node:assert/strict';
import test from 'node:test';

import { parseInboxIndex } from '../src/lib/inboxIndex.ts';

test('inbox index: wrapped object (the format SharedVault.swift writes)', () => {
  const raw = JSON.stringify({
    items: [
      { file: 'frame-1.png', width: 1170, height: 2532 },
      { file: 'frame-2.png', width: 1170, height: 2532 },
    ],
    finished: true,
  });
  const parsed = parseInboxIndex(raw);
  assert.equal(parsed.finished, true);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].file, 'frame-1.png');
});

test('inbox index: bare array is accepted, finished defaults to false', () => {
  const parsed = parseInboxIndex('[{"file":"a.png"},{"file":"b.png"}]');
  assert.equal(parsed.finished, false);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[1].file, 'b.png');
});

test('inbox index: garbage returns an empty index instead of throwing', () => {
  assert.deepEqual(parseInboxIndex('not json at all'), {
    items: [],
    finished: false,
  });
  assert.deepEqual(parseInboxIndex(''), { items: [], finished: false });
  assert.deepEqual(parseInboxIndex('null'), { items: [], finished: false });
  assert.deepEqual(parseInboxIndex('{"items": 42}'), {
    items: [],
    finished: false,
  });
  assert.deepEqual(parseInboxIndex('{"finished": true}'), {
    items: [],
    finished: true,
  });
});
