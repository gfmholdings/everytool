import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState as RNAppState } from 'react-native';

import * as ops from '../lib/clips';
import { type AppState, type Clip, type QrHistoryItem, emptyState } from '../types';
import { parseState, readSharedState, writeSharedState } from './sharedVault';

const KEY = 'everytool.state.v1';

interface StoreApi {
  ready: boolean;
  state: AppState;
  addClip: (text: string) => Clip | null;
  updateClip: (id: string, text: string) => void;
  togglePin: (id: string) => void;
  deleteClip: (id: string) => void;
  clearUnpinnedClips: () => void;
  addQrHistory: (item: Omit<QrHistoryItem, 'id' | 'createdAt'>) => void;
  deleteQrHistory: (id: string) => void;
  clearQrHistory: () => void;
  /** Re-read the App Group (the keyboard may have changed clips). */
  refresh: () => void;
}

const noop = () => {};
const StoreContext = createContext<StoreApi>({
  ready: false,
  state: emptyState,
  addClip: () => null,
  updateClip: noop,
  togglePin: noop,
  deleteClip: noop,
  clearUnpinnedClips: noop,
  addQrHistory: noop,
  deleteQrHistory: noop,
  clearQrHistory: noop,
  refresh: noop,
});

export function useStore(): StoreApi {
  return useContext(StoreContext);
}

/** Pinned first, then newest first — the order the keyboard shows too. */
export const sortedClips = ops.sortClips;

/**
 * App state, with the App Group document as the source of truth.
 *
 * Every mutation is read-modify-write: it re-reads the shared document
 * (the keyboard may have saved, edited or deleted clips since), applies
 * the change, and writes it back — so the app never overwrites the
 * keyboard's edits with a stale in-memory copy. The store also re-reads
 * whenever the app becomes active, and screens can call refresh().
 */
export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(emptyState);
  const [ready, setReady] = useState(false);
  const current = useRef<AppState>(emptyState);

  const apply = useCallback((next: AppState, persistShared: boolean) => {
    current.current = next;
    setState(next);
    if (persistShared) writeSharedState(next);
    void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    const shared = readSharedState();
    if (shared && !ops.sameState(shared, current.current)) apply(shared, false);
  }, [apply]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let local: AppState | null = null;
      try {
        local = parseState(await AsyncStorage.getItem(KEY));
      } catch {
        local = null;
      }
      const shared = readSharedState();
      if (cancelled) return;
      if (shared) {
        // Carry over anything only the local copy has (clips saved by a
        // build whose shared vault wasn't linked), then publish it.
        const merged = local ? ops.mergeStates(shared, local) : shared;
        apply(merged, !ops.sameState(merged, shared));
      } else if (local) {
        apply(local, true);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const commit = useCallback(
    (change: (s: AppState) => AppState) => {
      const base = readSharedState() ?? current.current;
      apply(change(base), true);
    },
    [apply],
  );

  const api = useMemo<StoreApi>(
    () => ({
      ready,
      state,
      refresh,
      addClip: (text) => {
        let made: Clip | null = null;
        commit((s) => {
          const r = ops.addClip(s, text);
          made = r.clip;
          return r.state;
        });
        return made;
      },
      updateClip: (id, text) => commit((s) => ops.updateClip(s, id, text)),
      togglePin: (id) => commit((s) => ops.togglePin(s, id)),
      deleteClip: (id) => commit((s) => ops.deleteClip(s, id)),
      clearUnpinnedClips: () => commit((s) => ops.clearUnpinned(s)),
      addQrHistory: (item) =>
        commit((s) => ({
          ...s,
          qrHistory: [
            { ...item, id: ops.newClipId(), createdAt: Date.now() },
            ...s.qrHistory,
          ].slice(0, 100),
        })),
      deleteQrHistory: (id) =>
        commit((s) => ({
          ...s,
          qrHistory: s.qrHistory.filter((q) => q.id !== id),
        })),
      clearQrHistory: () => commit((s) => ({ ...s, qrHistory: [] })),
    }),
    [ready, state, refresh, commit],
  );

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}
