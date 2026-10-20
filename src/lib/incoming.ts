import { Directory, File, Paths } from 'expo-file-system';

import type { ToolId } from '../types';
import { groupContainerUri } from '../store/sharedVault';
import { parseInboxIndex } from './inboxIndex';

export { parseInboxIndex };

/**
 * Inboxes in the App Group container, written by the extensions:
 * - ShareInbox/index.json — files shared into Everytool, each tagged with
 *   the tool the user picked in the share sheet.
 * - BroadcastInbox/index.json — frames from a finished screen recording,
 *   in capture order (the extension records no scroll offsets).
 * The app drains both whenever it comes to the foreground.
 */

export interface SharedItem {
  file: string; // name inside ShareInbox
  kind: 'image' | 'pdf' | 'text';
  tool: ToolId;
}

export interface BroadcastFrame {
  file: string; // name inside BroadcastInbox
  width: number;
  height: number;
}

/**
 * The pure index parser lives in inboxIndex.ts (dependency-free, so it
 * stays unit-testable like the other lib modules); it is imported above
 * for the drains and re-exported so inbox consumers import everything
 * from one place.
 */

function inboxDir(name: string): Directory | null {
  const base = groupContainerUri();
  if (!base) return null;
  return new Directory(base, name);
}

export async function drainShareInbox(): Promise<
  { item: SharedItem; uri: string }[]
> {
  const dir = inboxDir('ShareInbox');
  if (!dir || !dir.exists) return [];
  const indexFile = new File(dir, 'index.json');
  if (!indexFile.exists) return [];
  try {
    const raw = await indexFile.text();
    const items = parseInboxIndex(raw).items as SharedItem[];
    const out: { item: SharedItem; uri: string }[] = [];
    const destDir = new Directory(Paths.cache, 'share-inbox');
    if (!destDir.exists) destDir.create();
    for (const item of items) {
      const src = new File(dir, item.file);
      if (!src.exists) continue;
      const dest = new File(destDir, item.file);
      if (dest.exists) dest.delete();
      await src.copy(dest);
      out.push({ item, uri: dest.uri });
      src.delete();
    }
    indexFile.delete();
    return out;
  } catch {
    return [];
  }
}

export interface BroadcastInbox {
  frames: { uri: string; width: number; height: number }[];
  /** The recording has stopped (the extension flagged the index). */
  finished: boolean;
}

/**
 * The frames a screen recording left in the App Group, in capture order.
 * Frames stay in place (they are large) until clearBroadcastInbox().
 */
export async function readBroadcastInbox(): Promise<BroadcastInbox> {
  const empty: BroadcastInbox = { frames: [], finished: false };
  const dir = inboxDir('BroadcastInbox');
  if (!dir || !dir.exists) return empty;
  const indexFile = new File(dir, 'index.json');
  if (!indexFile.exists) return empty;
  try {
    const raw = await indexFile.text();
    const index = parseInboxIndex(raw);
    const frames: BroadcastInbox['frames'] = [];
    for (const frame of index.items as BroadcastFrame[]) {
      const src = new File(dir, frame.file);
      if (!src.exists) continue;
      frames.push({ uri: src.uri, width: frame.width, height: frame.height });
    }
    return { frames, finished: index.finished };
  } catch {
    return empty;
  }
}

/** Back-compat: just the frames. */
export async function drainBroadcastInbox(): Promise<BroadcastInbox['frames']> {
  return (await readBroadcastInbox()).frames;
}

/** Clear the broadcast inbox after a successful stitch (frames are big). */
export function clearBroadcastInbox(): void {
  const dir = inboxDir('BroadcastInbox');
  if (!dir || !dir.exists) return;
  try {
    dir.delete();
  } catch {
    // best effort
  }
}
