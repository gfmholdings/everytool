import { requireOptionalNativeModule } from 'expo-modules-core';

import { APP_GROUP_ID, BROADCAST_EXTENSION_ID } from '../config';
import type { AppState } from '../types';

/**
 * The shared vault lives in the App Group container so the app, the
 * keyboard extension, the share extension and the broadcast extension all
 * read the same clipboard + QR history. The native side is the local Expo
 * module in modules/shared-vault (linked through its podspec), wrapping
 * UserDefaults(suiteName:) with one JSON document, exactly mirroring the
 * Swift `SharedVault` the extensions compile.
 *
 * When the native module is absent (Expo Go), reads return null and
 * writes are dropped — AppStore keeps an AsyncStorage copy instead.
 */
interface SharedVaultNative {
  readStateJson(groupId: string): string | null;
  writeStateJson(groupId: string, json: string): boolean;
  groupContainerUri(groupId: string): string | null;
  takePendingTool(groupId: string): string | null;
  readGroupString?(groupId: string, key: string): string | null;
  writeGroupString?(groupId: string, key: string, value: string | null): boolean;
  showBroadcastPicker?(extensionBundleId: string): Promise<boolean>;
  requestNotificationPermission?(): Promise<boolean>;
}

const native =
  requireOptionalNativeModule<SharedVaultNative>('EverytoolSharedVault');

export function sharedVaultAvailable(): boolean {
  return native != null;
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

export function parseState(json: string | null | undefined): AppState | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<AppState>;
    return {
      clips: Array.isArray(parsed.clips)
        ? parsed.clips.filter((c) => c && typeof c.text === 'string' && typeof c.id === 'string')
        : [],
      qrHistory: Array.isArray(parsed.qrHistory) ? parsed.qrHistory : [],
    };
  } catch {
    return null;
  }
}

export function readSharedState(): AppState | null {
  if (!native) return null;
  try {
    return parseState(native.readStateJson(APP_GROUP_ID));
  } catch {
    return null;
  }
}

export function writeSharedState(state: AppState): void {
  if (!native) return;
  try {
    native.writeStateJson(APP_GROUP_ID, JSON.stringify(state));
  } catch {
    // Best effort: a failed write must never crash a tool.
  }
}

/**
 * Raise Apple's screen-broadcast sheet with Everytool preselected.
 * Resolves false when it can't be shown (Expo Go / no window).
 */
export async function showBroadcastPicker(): Promise<boolean> {
  if (!native?.showBroadcastPicker) return false;
  try {
    return await native.showBroadcastPicker(BROADCAST_EXTENSION_ID);
  } catch {
    return false;
  }
}

/** Ask once so the broadcast extension can say "ready" when it stops. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!native?.requestNotificationPermission) return false;
  try {
    return await native.requestNotificationPermission();
  } catch {
    return false;
  }
}

/**
 * A small shared string from the App Group. Returns undefined when the
 * native module is unavailable (callers keep their own fallback).
 */
export function readGroupString(key: string): string | null | undefined {
  if (!native?.readGroupString) return undefined;
  try {
    return native.readGroupString(APP_GROUP_ID, key);
  } catch {
    return undefined;
  }
}

export function writeGroupString(key: string, value: string | null): void {
  if (!native?.writeGroupString) return;
  try {
    native.writeGroupString(APP_GROUP_ID, key, value);
  } catch {
    // best effort
  }
}
