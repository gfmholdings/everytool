import * as MediaLibrary from 'expo-media-library/legacy';

import { readGroupString, writeGroupString } from '../store/sharedVault';
import { selectSessionShots, type PhotoMeta } from './sessionPick';
import type { ShotInput } from './stitch';

/**
 * Screenshot sessions: "Start", take ordinary screenshots while
 * scrolling (in any app), come back, and Everytool stitches every
 * screenshot taken since Start. The start time lives in the App Group so
 * the Control Center control can begin a session without opening the app.
 */
const KEY = 'everytool.screenshotSession';
let memoryStart: number | null = null; // fallback without the native module

export function sessionStart(): number | null {
  const raw = readGroupString(KEY);
  if (raw === undefined) return memoryStart;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function startSession(now: number = Date.now()): void {
  memoryStart = now;
  writeGroupString(KEY, String(now));
}

export function endSession(): void {
  memoryStart = null;
  writeGroupString(KEY, null);
}

export type PhotoAccess = 'all' | 'limited' | 'denied';

/** Full Photos access is needed: new screenshots aren't in a "limited" selection. */
export async function ensurePhotoAccess(): Promise<PhotoAccess> {
  try {
    const perm = await MediaLibrary.requestPermissionsAsync(false);
    if (!perm.granted) return 'denied';
    return perm.accessPrivileges === 'limited' ? 'limited' : 'all';
  } catch {
    return 'denied';
  }
}

export async function openLimitedPicker(): Promise<void> {
  try {
    await MediaLibrary.presentPermissionsPickerAsync(['photo']);
  } catch {
    // not limited / unavailable
  }
}

export interface SessionShot extends ShotInput {
  assetId: string;
}

/** Screenshots taken since `startMs`, oldest first, as stitchable files. */
export async function sessionShots(startMs: number): Promise<SessionShot[]> {
  const page = await MediaLibrary.getAssetsAsync({
    mediaType: MediaLibrary.MediaType.photo,
    mediaSubtypes: ['screenshot'],
    createdAfter: startMs - 2000,
    sortBy: [[MediaLibrary.SortBy.creationTime, true]],
    first: 1000,
  });
  const metas: PhotoMeta[] = page.assets.map((a) => ({
    id: a.id,
    creationTime: a.creationTime,
    width: a.width,
    height: a.height,
    mediaSubtypes: a.mediaSubtypes,
  }));
  const picked = selectSessionShots(metas, startMs);
  const out: SessionShot[] = [];
  for (const meta of picked) {
    // localUri is a real file:// path the image pipeline can read
    // (iCloud-only originals are downloaded by Photos on request).
    const info = await MediaLibrary.getAssetInfoAsync(meta.id, {
      shouldDownloadFromNetwork: true,
    });
    if (!info.localUri) continue;
    out.push({ assetId: meta.id, uri: info.localUri, width: meta.width, height: meta.height });
  }
  return out;
}

/** Count only (cheap) — for the live "N screenshots so far" line. */
export async function countSessionShots(startMs: number): Promise<number> {
  const page = await MediaLibrary.getAssetsAsync({
    mediaType: MediaLibrary.MediaType.photo,
    mediaSubtypes: ['screenshot'],
    createdAfter: startMs - 2000,
    first: 1000,
  });
  return selectSessionShots(
    page.assets.map((a) => ({
      id: a.id,
      creationTime: a.creationTime,
      width: a.width,
      height: a.height,
      mediaSubtypes: a.mediaSubtypes,
    })),
    startMs,
  ).length;
}

/** Delete the source screenshots (iOS shows its own confirmation). */
export async function deleteSessionShots(assetIds: string[]): Promise<boolean> {
  if (assetIds.length === 0) return true;
  try {
    return await MediaLibrary.deleteAssetsAsync(assetIds);
  } catch {
    return false;
  }
}
