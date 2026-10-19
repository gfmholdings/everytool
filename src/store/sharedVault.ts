import { requireOptionalNativeModule } from 'expo-modules-core';

import { APP_GROUP_ID } from '../config';
import type { AppState } from '../types';

/**
 * The shared vault lives in the App Group container so the app, the
 * keyboard extension, the share extension and the broadcast extension all
 * read the same clipboard + QR history. The native side is a tiny module
 * (modules/shared-vault) wrapping UserDefaults(suiteName:) with a JSON
 * document, exactly mirroring the Swift `SharedVault` the extensions use.
 *
 * When the native module is absent (Expo Go), reads fall back to an
 * in-memory empty state and writes are dropped silently — data features
 * need a native build, which is also the only place the extensions exist.
 */
interface SharedVaultNative {
  readStateJson(groupId: string): string | null;
  writeStateJson(groupId: string, json: string): boolean;
  groupContainerUri(groupId: string): string | null;
  takePendingTool(groupId: string): string | null;
}

/**
 * Control Center controls record their tool in the App Group (their
 * AppIntent cannot route inside React Native). Read + clear it.
 */
export function takePendingTool(): string | null {
  if (!native) return null;
  try {
    return native.takePendingTool(APP_GROUP_ID);
  } catch {
    return null;
  }
}

/** file:// URI of the App Group container, or null without the module.
 *  The share inbox and broadcast frames live under it. */
export function groupContainerUri(): string | null {
  if (!native) return null;
  try {
    return native.groupContainerUri(APP_GROUP_ID);
  } catch {
    return null;
  }
}

const native =
  requireOptionalNativeModule<SharedVaultNative>('EverytoolSharedVault');

export function sharedVaultAvailable(): boolean {
  return native != null;
}

export function readSharedState(): AppState | null {
  if (!native) return null;
  try {
    const json = native.readStateJson(APP_GROUP_ID);
    if (!json) return null;
    const parsed = JSON.parse(json) as Partial<AppState>;
    return {
      clips: Array.isArray(parsed.clips) ? parsed.clips : [],
      qrHistory: Array.isArray(parsed.qrHistory) ? parsed.qrHistory : [],
    };
  } catch {
    return null;
  }
}

export function writeSharedState(state: AppState): void {
  if (!native) return;
  try {
    native.writeStateJson(APP_GROUP_ID, JSON.stringify(state));
  } catch {
    // Best effort: the vault is a convenience cache of the user's own
    // clips; a failed write must never crash a tool.
  }
}
