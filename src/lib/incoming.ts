import { Directory, File, Paths } from 'expo-file-system';

import type { ToolId } from '../types';
import { groupContainerUri } from '../store/sharedVault';

/**
 * Inboxes in the App Group container, written by the extensions:
 * - ShareInbox/index.json — files shared into Everytool, each tagged with
 *   the tool the user picked in the share sheet.
 * - BroadcastInbox/index.json — frames from a finished screen recording,
 *   with the scroll offsets the broadcast extension measured.
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
  offsetY: number;
}

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
    const items = JSON.parse(raw) as SharedItem[];
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

export async function drainBroadcastInbox(): Promise<
  { uri: string; width: number; height: number; offsetY: number }[]
> {
  const dir = inboxDir('BroadcastInbox');
  if (!dir || !dir.exists) return [];
  const indexFile = new File(dir, 'index.json');
  if (!indexFile.exists) return [];
  try {
    const raw = await indexFile.text();
    const frames = JSON.parse(raw) as BroadcastFrame[];
    const out: {
      uri: string;
      width: number;
      height: number;
      offsetY: number;
    }[] = [];
    for (const frame of frames) {
      const src = new File(dir, frame.file);
      if (!src.exists) continue;
      out.push({
        uri: src.uri,
        width: frame.width,
        height: frame.height,
        offsetY: frame.offsetY,
      });
    }
    return out;
  } catch {
    return [];
  }
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
