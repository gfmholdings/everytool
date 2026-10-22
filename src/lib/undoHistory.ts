// Shared undo history. A bounded stack of snapshots: commit pushes the
// current value, undo and redo walk it, and a grouped commit (typing)
// replaces the latest step instead of adding one per keystroke.
// No local imports: the Node tests load this file on its own.

export const UNDO_LIMIT = 50;

export type UndoHistory<T> = {
  past: T[];
  present: T;
  future: T[];
  limit: number;
  /** The latest commit was a grouped edit, so the next grouped commit replaces it. */
  grouped: boolean;
};

export function createHistory<T>(present: T, limit = UNDO_LIMIT): UndoHistory<T> {
  return { past: [], present, future: [], limit, grouped: false };
}

function sameValue<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Record `next`. Identical values are ignored. `group` folds a run of
 * edits (a typing session) into one step. A non-grouped commit always
 * starts a new step and drops anything that had been redone.
 */
export function commit<T>(history: UndoHistory<T>, next: T, group = false): UndoHistory<T> {
  if (sameValue(history.present, next)) {
    return history.grouped === group ? history : { ...history, grouped: group };
  }
  if (group && history.grouped) {
    return { ...history, present: next, future: [], grouped: true };
  }
  const past = [...history.past, history.present].slice(-history.limit);
  return { past, present: next, future: [], limit: history.limit, grouped: group };
}

export function canUndo<T>(history: UndoHistory<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: UndoHistory<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: UndoHistory<T>): UndoHistory<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    limit: history.limit,
    grouped: false,
  };
}

export function redo<T>(history: UndoHistory<T>): UndoHistory<T> {
  const next = history.future[0];
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
    limit: history.limit,
    grouped: false,
  };
}

/**
 * A shake is a sharp rise in acceleration followed by a reversal.
 * Samples are in g, gravity removed. Optional: nothing in the app feeds
 * samples until a motion source calls this.
 */
export function isShake(
  samples: readonly { x: number; y: number; z: number }[],
  threshold = 1.4,
): boolean {
  if (samples.length < 3) return false;
  const mag = (s: { x: number; y: number; z: number }) => Math.hypot(s.x, s.y, s.z);
  let rose = false;
  let fell = false;
  for (let i = 1; i < samples.length; i += 1) {
    const delta = mag(samples[i]!) - mag(samples[i - 1]!);
    if (delta >= threshold) rose = true;
    if (rose && delta <= -threshold) fell = true;
  }
  return rose && fell;
}
