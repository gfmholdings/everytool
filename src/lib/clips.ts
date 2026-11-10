// Clipboard vault operations — pure functions over AppState, shared in
// spirit with targets/_shared/SharedVault.swift (the keyboard's side).
// Same rules on both sides: trimmed text, no empty clips, saving text
// that already exists moves it to the top instead of duplicating it, and
// the vault keeps at most MAX_CLIPS (oldest unpinned go first).

import type { AppState, Clip } from '../types';

export const MAX_CLIPS = 500;

export function newClipId(now: number = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Pinned first, then newest first — the order the keyboard shows too. */
export function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
}

function bounded(clips: Clip[]): Clip[] {
  if (clips.length <= MAX_CLIPS) return clips;
  const out = [...clips];
  for (let i = out.length - 1; i >= 0 && out.length > MAX_CLIPS; i -= 1) {
    if (!out[i]!.pinned) out.splice(i, 1);
  }
  return out;
}

export function addClip(
  state: AppState,
  text: string,
  now: number = Date.now(),
  id: string = newClipId(now),
): { state: AppState; clip: Clip | null } {
  const trimmed = text.trim();
  if (!trimmed) return { state, clip: null };
  const existing = state.clips.find((c) => c.text === trimmed);
  if (existing) {
    const moved = { ...existing, createdAt: now };
    return {
      state: {
        ...state,
        clips: [moved, ...state.clips.filter((c) => c.id !== existing.id)],
      },
      clip: moved,
    };
  }
  const clip: Clip = { id, text: trimmed, pinned: false, createdAt: now };
  return { state: { ...state, clips: bounded([clip, ...state.clips]) }, clip };
}

export function updateClip(state: AppState, id: string, text: string): AppState {
  const trimmed = text.trim();
  if (!trimmed) return state;
  return {
    ...state,
    clips: state.clips.map((c) => (c.id === id ? { ...c, text: trimmed } : c)),
  };
}

export function togglePin(state: AppState, id: string): AppState {
  return {
    ...state,
    clips: state.clips.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
  };
}

export function deleteClip(state: AppState, id: string): AppState {
  return { ...state, clips: state.clips.filter((c) => c.id !== id) };
}

export function clearUnpinned(state: AppState): AppState {
  return { ...state, clips: state.clips.filter((c) => c.pinned) };
}

/**
 * Merge a second copy of the state into the primary one (by id). Used
 * once at launch to carry clips saved while the shared vault wasn't
 * reachable (older builds kept them only in AsyncStorage) into the App
 * Group, where the keyboard can see them.
 */
export function mergeStates(primary: AppState, extra: AppState): AppState {
  const cdIds = new Set(primary.countdowns.map((c) => c.id));
  const clipIds = new Set(primary.clips.map((c) => c.id));
  const clipTexts = new Set(primary.clips.map((c) => c.text));
  const qrIds = new Set(primary.qrHistory.map((q) => q.id));
  return {
    clips: bounded([
      ...primary.clips,
      ...extra.clips.filter((c) => !clipIds.has(c.id) && !clipTexts.has(c.text)),
    ]),
    qrHistory: [
      ...primary.qrHistory,
      ...extra.qrHistory.filter((q) => !qrIds.has(q.id)),
    ]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100),
    countdowns: [...primary.countdowns, ...extra.countdowns.filter((c) => !cdIds.has(c.id))],
  };
}

export function sameState(a: AppState, b: AppState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Existing shared state is authoritative, including deletions and empty lists.
 * Only migrate the local fallback when no shared document exists. */
export function startupState(shared: AppState | null, local: AppState | null): AppState {
  return shared ?? local ?? { clips: [], qrHistory: [], countdowns: [] };
}

// ---- Snippets --------------------------------------------------------------
// A clip can carry a shortcut word ("addr"). In the Everytool keyboard,
// typing that word and then space replaces it with the clip's text. The
// Swift side (KeyboardViewController.expandSnippet) applies the same rule.

export const SNIPPET_RE = /^[a-z0-9][a-z0-9_.-]{1,15}$/;

export function normalizeShortcut(raw: string): string {
  return raw.trim().replace(/^[;:/]+/, '').toLowerCase();
}

/** null when valid, otherwise the problem in plain words. */
export function shortcutProblem(state: AppState, id: string, raw: string): string | null {
  const s = normalizeShortcut(raw);
  if (!s) return null; // clearing is always fine
  if (!SNIPPET_RE.test(s)) return 'Use 2–16 letters or numbers (no spaces).';
  if (state.clips.some((c) => c.id !== id && c.shortcut === s)) {
    return `“${s}” is already used by another clip.`;
  }
  return null;
}

export function setShortcut(state: AppState, id: string, raw: string): AppState {
  if (shortcutProblem(state, id, raw)) return state;
  const s = normalizeShortcut(raw);
  return {
    ...state,
    clips: state.clips.map((c) => {
      if (c.id !== id) return c;
      const next = { ...c };
      if (s) next.shortcut = s;
      else delete next.shortcut;
      return next;
    }),
  };
}

/**
 * The expansion for the word just typed before the cursor, if it is a
 * snippet shortcut. `before` is the text before the cursor (no trailing
 * space yet). Returns the number of characters to delete and the text.
 */
export function matchSnippet(
  clips: Clip[],
  before: string,
): { remove: number; insert: string } | null {
  const m = /(^|\s)([^\s]{2,16})$/.exec(before);
  if (!m) return null;
  const word = m[2]!.toLowerCase();
  const clip = clips.find((c) => c.shortcut === word);
  return clip ? { remove: m[2]!.length, insert: clip.text } : null;
}
