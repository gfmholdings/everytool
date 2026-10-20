// Which photos belong to a screenshot session — pure, unit-tested.
//
// A session starts when the user taps "Start" (in the app or the Control
// Center control). Every screenshot created after that moment, in the
// order taken, is a piece of the long screenshot. Photos that aren't
// screenshots (camera shots, saved images) and screenshots of a
// different size (taken on another device and synced, or in landscape)
// are left out.

export interface PhotoMeta {
  id: string;
  /** ms since epoch */
  creationTime: number;
  width: number;
  height: number;
  /** iOS PHAsset subtypes; undefined when the platform doesn't report them. */
  mediaSubtypes?: string[];
}

/** Clock slack: Photos stamps creation a moment after the shutter. */
const GRACE_MS = 1500;

export function selectSessionShots(photos: PhotoMeta[], startMs: number): PhotoMeta[] {
  const inSession = photos
    .filter((p) => p.creationTime >= startMs - GRACE_MS)
    .filter((p) => !p.mediaSubtypes || p.mediaSubtypes.includes('screenshot'))
    .filter((p) => p.width > 0 && p.height > 0 && p.height > p.width) // portrait screens
    .sort((a, b) => a.creationTime - b.creationTime || a.id.localeCompare(b.id));
  if (inSession.length === 0) return [];
  // Keep the dominant screen size (ties: the size of the first shot).
  const counts = new Map<string, number>();
  for (const p of inSession) {
    const k = `${p.width}x${p.height}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const firstKey = `${inSession[0]!.width}x${inSession[0]!.height}`;
  let best = firstKey;
  for (const [k, n] of counts) {
    if (n > (counts.get(best) ?? 0)) best = k;
  }
  const seen = new Set<string>();
  return inSession.filter((p) => {
    if (`${p.width}x${p.height}` !== best || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}
