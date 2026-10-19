import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { type AppState, type Clip, type QrHistoryItem, emptyState } from '../types';
import { readSharedState, writeSharedState } from './sharedVault';

const KEY = 'everytool.state.v1';

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface StoreApi {
  ready: boolean;
  state: AppState;
  addClip: (text: string) => Clip | null;
  togglePin: (id: string) => void;
  deleteClip: (id: string) => void;
  addQrHistory: (item: Omit<QrHistoryItem, 'id' | 'createdAt'>) => void;
  deleteQrHistory: (id: string) => void;
  clearQrHistory: () => void;
}

const StoreContext = createContext<StoreApi>({
  ready: false,
  state: emptyState,
  addClip: () => null,
  togglePin: () => {},
  deleteClip: () => {},
  addQrHistory: () => {},
  deleteQrHistory: () => {},
  clearQrHistory: () => {},
});

export function useStore(): StoreApi {
  return useContext(StoreContext);
}

/** Pinned first, then newest first — the order the keyboard shows too. */
export function sortedClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(emptyState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The shared App Group document is the source of truth (the
      // extensions write there too); AsyncStorage is the fallback for
      // environments without the native vault module.
      const shared = readSharedState();
      if (shared) {
        if (!cancelled) {
          setState(shared);
          setReady(true);
        }
        return;
      }
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw && !cancelled) {
          const parsed = JSON.parse(raw) as Partial<AppState>;
          setState({
            clips: Array.isArray(parsed.clips) ? parsed.clips : [],
            qrHistory: Array.isArray(parsed.qrHistory) ? parsed.qrHistory : [],
          });
        }
      } catch {
        // start empty
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    writeSharedState(state);
    void AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
  }, [ready, state]);

  const api = useMemo<StoreApi>(
    () => ({
      ready,
      state,
      addClip: (text) => {
        const trimmed = text.trim();
        if (!trimmed) return null;
        const clip: Clip = {
          id: newId(),
          text: trimmed,
          pinned: false,
          createdAt: Date.now(),
        };
        setState((s) => ({ ...s, clips: [clip, ...s.clips] }));
        return clip;
      },
      togglePin: (id) =>
        setState((s) => ({
          ...s,
          clips: s.clips.map((c) =>
            c.id === id ? { ...c, pinned: !c.pinned } : c,
          ),
        })),
      deleteClip: (id) =>
        setState((s) => ({ ...s, clips: s.clips.filter((c) => c.id !== id) })),
      addQrHistory: (item) =>
        setState((s) => ({
          ...s,
          qrHistory: [
            { ...item, id: newId(), createdAt: Date.now() },
            ...s.qrHistory,
          ].slice(0, 100),
        })),
      deleteQrHistory: (id) =>
        setState((s) => ({
          ...s,
          qrHistory: s.qrHistory.filter((q) => q.id !== id),
        })),
      clearQrHistory: () => setState((s) => ({ ...s, qrHistory: [] })),
    }),
    [ready, state],
  );

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}
