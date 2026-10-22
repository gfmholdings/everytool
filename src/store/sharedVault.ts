import { requireOptionalNativeModule } from 'expo-modules-core';

import { APP_GROUP_ID, BROADCAST_EXTENSION_ID } from '../config';
import { normalizeQrHistory } from '../lib/qrHistory';
import type { TextBox } from '../lib/receipt';
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
  reloadWidgets?(): void;
  recognizeText?(uri: string): Promise<TextBox[]>;
  stripLocation?(inputUri: string, outputUri: string): boolean;
  imageHasLocation?(uri: string): boolean;
  reencodeImage?(
    inputUri: string,
    outputUri: string,
    format: string,
    quality: number,
    maxWidth: number,
    stripMetadata: boolean,
  ): number;
  showBroadcastPicker?(extensionBundleId: string): Promise<boolean>;
  requestNotificationPermission?(): Promise<boolean>;
  takeOpenedPdf?(sourceUrl: string): { uri: string; name: string } | null;
  sampleVideoFrames?(
    videoUri: string,
    timesMs: number[],
    maxWidth: number,
  ): Promise<{ uri: string; width: number; height: number; timeMs: number }[]>;
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
      qrHistory: normalizeQrHistory(parsed.qrHistory),
      countdowns: Array.isArray(parsed.countdowns)
        ? parsed.countdowns.filter(
            (c) => c && typeof c.title === 'string' && typeof c.date === 'number',
          )
        : [],
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

export function reloadWidgets(): void {
  try {
    native?.reloadWidgets?.();
  } catch {
    // widgets refresh on their own schedule anyway
  }
}

/** On-device OCR. null when unavailable (Expo Go). */
export async function recognizeText(uri: string): Promise<TextBox[] | null> {
  if (!native?.recognizeText) return null;
  return native.recognizeText(uri);
}

/** Lossless copy without GPS/XMP. false when unavailable or failed. */
export function stripLocation(inputUri: string, outputUri: string): boolean {
  try {
    return native?.stripLocation?.(inputUri, outputUri) ?? false;
  } catch {
    return false;
  }
}

/**
 * On-device re-encode (JPEG, PNG, or HEIC). Returns the byte size, or
 * null when the native encoder isn't available or the format failed.
 */
export function reencodeImage(
  inputUri: string,
  outputUri: string,
  format: 'jpeg' | 'png' | 'heic',
  quality: number,
  maxWidth: number,
  stripMetadata: boolean,
): number | null {
  try {
    const n = native?.reencodeImage?.(inputUri, outputUri, format, quality, maxWidth, stripMetadata);
    return n == null || n < 0 ? null : n;
  } catch {
    return null;
  }
}

/**
 * The sandbox copy of a PDF opened in place, if the native handler
 * already copied it. Null in Expo Go or when the URL was not a document open.
 */
export function takeOpenedPdf(sourceUrl: string): { uri: string; name: string } | null {
  if (!native?.takeOpenedPdf) return null;
  try {
    const got = native.takeOpenedPdf(sourceUrl);
    if (!got || typeof got.uri !== 'string' || !got.uri || typeof got.name !== 'string' || !got.name) {
      return null;
    }
    return { uri: got.uri, name: got.name };
  } catch {
    return null;
  }
}

/** null when it can't be checked here. */
export function imageHasLocation(uri: string): boolean | null {
  try {
    return native?.imageHasLocation ? native.imageHasLocation(uri) : null;
  } catch {
    return null;
  }
}
