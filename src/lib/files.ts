import { Image, Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';

import { shareItem } from './shareSheet';

/** Everytool works entirely on-device. Tool outputs land in the cache
 *  directory and leave only when the user shares or saves them. */

let seq = 0;
export function tempFileUri(extension: string, prefix = 'everytool'): string {
  seq += 1;
  const name = `${prefix}-${Date.now().toString(36)}-${seq}.${extension}`;
  return new File(Paths.cache, name).uri;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Opens the native iOS share sheet (UIActivityViewController via React
 * Native Share) on a real file URL. The file is the only activity item,
 * so Save Image, Copy, Print, AirDrop, Messages, Mail, and the other
 * apps stay available. `subject` is mail-only and is not a second item.
 */
export async function shareFile(
  uri: string,
  mimeType: string,
  options?: { subject?: string },
): Promise<boolean> {
  const item = shareItem({ uri, mimeType, subject: options?.subject });
  if (!item.url) return false;
  try {
    await Share.share({ url: item.url }, item.subject ? { subject: item.subject } : undefined);
    return true;
  } catch {
    return false;
  }
}

/** Native share sheet for plain text (clipboard, a bill split). */
export async function shareText(message: string): Promise<boolean> {
  const item = shareItem({ text: message });
  if (!item.message) return false;
  try {
    await Share.share({ message: item.message });
    return true;
  } catch {
    return false;
  }
}

/**
 * Save an image/GIF/video file to Photos. Asks only for add-only access
 * (NSPhotoLibraryAddUsageDescription). Uses the legacy entry point: in
 * this Expo SDK the root `saveToLibraryAsync` export throws at runtime.
 * Resolves a user-facing error message, or null on success.
 */
export async function saveToPhotos(uri: string): Promise<string | null> {
  try {
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (!perm.granted) {
      return 'Photo saving is off. Allow “Add Photos Only” for Everytool in Settings → Privacy → Photos.';
    }
    await MediaLibrary.saveToLibraryAsync(uri);
    return null;
  } catch (e) {
    return e instanceof Error
      ? `Couldn’t save to Photos (${e.message}). Try Share → Save Image or Save to Files.`
      : 'Couldn’t save to Photos. Try Share → Save to Files.';
  }
}

/** Pixel size of an image file (for files that arrive without one,
 *  e.g. from the share sheet). Resolves 0×0 if it can't be read. */
export function measureImage(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve({ width: 0, height: 0 }),
    );
  });
}
