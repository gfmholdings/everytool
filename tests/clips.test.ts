import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addClip,
  clearUnpinned,
  deleteClip,
  MAX_CLIPS,
  mergeStates,
  sortClips,
  togglePin,
  updateClip,
} from '../src/lib/clips.ts';
import { parseInboxIndex } from '../src/lib/inboxIndex.ts';
import type { AppState } from '../src/types.ts';

const empty: AppState = { clips: [], qrHistory: [], countdowns: [] };

test('clips: save trims, ignores blanks', () => {
  assert.equal(addClip(empty, '   ').clip, null);
  const r = addClip(empty, '  hello \n', 1000, 'a');
  assert.deepEqual(r.state.clips, [{ id: 'a', text: 'hello', pinned: false, createdAt: 1000 }]);
});

test('clips: saving existing text moves it to the top, no duplicate', () => {
  let s = addClip(empty, 'one', 1, 'a').state;
  s = addClip(s, 'two', 2, 'b').state;
  const r = addClip(s, 'one', 3, 'c');
  assert.equal(r.state.clips.length, 2);
  assert.equal(r.clip?.id, 'a');
  assert.deepEqual(sortClips(r.state.clips).map((c) => c.text), ['one', 'two']);
});

test('clips: edit, pin, delete, clear keeps pinned', () => {
  let s = addClip(empty, 'one', 1, 'a').state;
  s = addClip(s, 'two', 2, 'b').state;
  s = updateClip(s, 'a', ' uno ');
  assert.equal(s.clips.find((c) => c.id === 'a')?.text, 'uno');
  assert.equal(updateClip(s, 'a', '   '), s, 'blank edit is ignored');
  s = togglePin(s, 'a');
  assert.deepEqual(sortClips(s.clips).map((c) => c.id), ['a', 'b'], 'pinned first');
  s = clearUnpinned(s);
  assert.deepEqual(s.clips.map((c) => c.id), ['a']);
  s = deleteClip(s, 'a');
  assert.equal(s.clips.length, 0);
});

test('clips: vault is bounded and never drops pinned clips', () => {
  let s: AppState = empty;
  s = togglePin(addClip(s, 'keep me', 0, 'pin').state, 'pin');
  for (let i = 1; i <= MAX_CLIPS + 20; i += 1) s = addClip(s, `clip ${i}`, i, `c${i}`).state;
  assert.equal(s.clips.length, MAX_CLIPS);
  assert.ok(s.clips.some((c) => c.id === 'pin'));
  assert.ok(s.clips.some((c) => c.id === `c${MAX_CLIPS + 20}`), 'newest kept');
});

test('clips: merge carries local-only clips into the shared vault once', () => {
  const shared = addClip(empty, 'from keyboard', 5, 'k').state;
  const local = addClip(addClip(empty, 'from app', 3, 'p').state, 'from keyboard', 4, 'dup').state;
  const merged = mergeStates(shared, local);
  assert.deepEqual(merged.clips.map((c) => c.id).sort(), ['k', 'p']);
  assert.deepEqual(mergeStates(merged, local), merged, 'idempotent');
});

test('inbox index: finished flag and items survive, garbage is empty', () => {
  assert.deepEqual(parseInboxIndex('{"items":[{"file":"a"}],"finished":true}'), {
    items: [{ file: 'a' }],
    finished: true,
  });
  assert.deepEqual(parseInboxIndex('nope'), { items: [], finished: false });
});
