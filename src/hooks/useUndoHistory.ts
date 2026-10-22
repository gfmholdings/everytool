import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  canRedo,
  canUndo,
  commit as commitHistory,
  createHistory,
  isShake,
  undo as undoHistory,
  redo as redoHistory,
  UNDO_LIMIT,
  type UndoHistory,
} from '../lib/undoHistory';

const shakeListeners = new Set<() => void>();

/** Optional shake-to-undo. Feed accelerometer samples (g, gravity removed). */
export function feedMotion(samples: readonly { x: number; y: number; z: number }[]): void {
  if (!isShake(samples)) return;
  for (const listener of shakeListeners) listener();
}

function tap(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/**
 * One tool's undo stack. `commit` records a step. Pass `group: true` for
 * typing so a run of keystrokes is one step. Undo and redo haptic.
 * `shake: true` undoes when `feedMotion` sees a shake.
 */
export function useUndoHistory<T>(initial: T, options?: { limit?: number; haptic?: boolean; shake?: boolean }) {
  const limit = options?.limit ?? UNDO_LIMIT;
  const hapticOn = options?.haptic !== false;
  const [history, setHistory] = useState<UndoHistory<T>>(() => createHistory(initial, limit));
  const ref = useRef(history);
  useEffect(() => {
    ref.current = history;
  });

  const commit = useCallback((next: T | ((current: T) => T), group = false) => {
    setHistory((current) => {
      const value = typeof next === 'function' ? (next as (c: T) => T)(current.present) : next;
      const updated = commitHistory(current, value, group);
      ref.current = updated;
      return updated;
    });
  }, []);

  const undo = useCallback(() => {
    const next = undoHistory(ref.current);
    if (next === ref.current) return ref.current.present;
    if (hapticOn) tap();
    ref.current = next;
    setHistory(next);
    return next.present;
  }, [hapticOn]);

  const redo = useCallback(() => {
    const next = redoHistory(ref.current);
    if (next === ref.current) return ref.current.present;
    if (hapticOn) tap();
    ref.current = next;
    setHistory(next);
    return next.present;
  }, [hapticOn]);

  const reset = useCallback(
    (present: T) => {
      const next = createHistory(present, limit);
      ref.current = next;
      setHistory(next);
    },
    [limit],
  );

  useEffect(() => {
    if (!options?.shake) return;
    const listener = () => {
      undo();
    };
    shakeListeners.add(listener);
    return () => {
      shakeListeners.delete(listener);
    };
  }, [options?.shake, undo]);

  return {
    present: history.present,
    commit,
    undo,
    redo,
    reset,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
  };
}
