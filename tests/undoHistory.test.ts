import assert from 'node:assert/strict';
import test from 'node:test';

import { deleteMark, INK_BLACK, moveMark, resizeMark, type PageMark } from '../src/lib/pdfSign.ts';
import {
  UNDO_LIMIT,
  canRedo,
  canUndo,
  commit,
  createHistory,
  isShake,
  redo,
  undo,
} from '../src/lib/undoHistory.ts';

test('undo history pushes, undoes, and redoes', () => {
  let history = createHistory('a');
  history = commit(history, 'b');
  history = commit(history, 'c');
  assert.equal(history.present, 'c');
  assert.equal(canUndo(history), true);
  history = undo(history);
  assert.equal(history.present, 'b');
  history = undo(history);
  assert.equal(history.present, 'a');
  assert.equal(canUndo(history), false);
  history = undo(history);
  assert.equal(history.present, 'a');
  history = redo(history);
  assert.equal(history.present, 'b');
  assert.equal(canRedo(history), true);
  history = redo(history);
  assert.equal(history.present, 'c');
  assert.equal(canRedo(history), false);
});

test('a new edit drops the redo tail', () => {
  let history = commit(commit(createHistory('a'), 'b'), 'c');
  history = undo(history);
  history = commit(history, 'd');
  assert.equal(history.present, 'd');
  assert.equal(canRedo(history), false);
  history = undo(history);
  assert.equal(history.present, 'b');
});

test('identical commits and grouped typing are one step', () => {
  let history = commit(createHistory('hi'), 'hi');
  assert.equal(history.past.length, 0);
  history = commit(history, 'h', true);
  history = commit(history, 'hi', true);
  history = commit(history, 'hit', true);
  assert.deepEqual(history.past, ['hi']);
  assert.equal(history.present, 'hit');
  history = commit(history, 'HIT', false);
  assert.equal(history.past.length, 2);
  history = undo(history);
  assert.equal(history.present, 'hit');
});

test('the stack keeps the newest 50 steps', () => {
  let history = createHistory(0);
  for (let i = 1; i <= UNDO_LIMIT + 10; i += 1) history = commit(history, i);
  assert.equal(history.past.length, UNDO_LIMIT);
  assert.equal(history.past[0], 10);
  assert.equal(history.present, UNDO_LIMIT + 10);
  for (let i = 0; i < UNDO_LIMIT; i += 1) history = undo(history);
  assert.equal(history.present, 10);
  assert.equal(canUndo(history), false);
});

test('object edits compare by value so a no-op does not stack', () => {
  let history = createHistory({ n: 1 });
  history = commit(history, { n: 1 });
  assert.equal(history.past.length, 0);
  history = commit(history, { n: 2 });
  history = undo(history);
  assert.deepEqual(history.present, { n: 1 });
});

test('sign and fill placements undo a move, resize, and delete', () => {
  const mark = (id: string, x: number): PageMark => ({
    id,
    page: 0,
    kind: 'signature',
    rect: { x, y: 10, width: 40, height: 20 },
    text: '',
    color: INK_BLACK,
    strokes: [],
  });
  let marks = [mark('a', 10), mark('b', 80)];
  let history = createHistory(marks);
  marks = marks.map((item) => (item.id === 'a' ? moveMark(item, 15, 0, 200, 200) : item));
  history = commit(history, marks);
  marks = marks.map((item) => (item.id === 'b' ? resizeMark(item, 50, 24, 200, 200) : item));
  history = commit(history, marks);
  marks = deleteMark(marks, 'a');
  history = commit(history, marks);
  assert.equal(history.present.length, 1);
  history = undo(history);
  assert.equal(history.present.length, 2);
  assert.equal(history.present.find((item) => item.id === 'b')?.rect.width, 50);
  history = undo(history);
  assert.equal(history.present.find((item) => item.id === 'a')?.rect.x, 25);
  history = undo(history);
  assert.equal(history.present[0]?.rect.x, 10);
  history = redo(history);
  history = redo(history);
  history = redo(history);
  assert.deepEqual(
    history.present.map((item) => item.id),
    ['b'],
  );
  history = commit(history, history.present);
  assert.equal(canRedo(history), false);
});

test('a shake is a spike that reverses, not a slow tilt', () => {
  assert.equal(
    isShake([
      { x: 0, y: 0, z: 0 },
      { x: 0.2, y: 0, z: 0 },
      { x: 0.4, y: 0, z: 0 },
    ]),
    false,
  );
  assert.equal(
    isShake([
      { x: 0, y: 0, z: 0 },
      { x: 2.2, y: 0.4, z: 0 },
      { x: 0.1, y: 0, z: 0 },
    ]),
    true,
  );
  assert.equal(isShake([{ x: 3, y: 0, z: 0 }]), false);
});
