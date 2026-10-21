import { Image } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';

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

const UTI: Record<string, string> = {
  'image/png': 'public.png',
  'image/jpeg': 'public.jpeg',
  'image/gif': 'com.compuserve.gif',
  'application/pdf': 'com.adobe.pdf',
};

/** Opens the share sheet (AirDrop, Messages, Save to Files, …). */
export async function shareFile(uri: string, mimeType: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType, UTI: UTI[mimeType] });
  return true;
}

/**
 * Save an image/GIF/video file to Photos. Asks only for add-only access
 * (NSPhotoLibraryAddUsageDescription). Uses the legacy entry point: in
 * this Expo SDK the root `saveToLibraryAsync` export throws at runtime.
 * Resolves a user-facing error message, or null on success.
 */
export async function saveToPhotos(uri: string): Promise<string | null> {
  // [saveprobe] TEMPORARY diagnosis (flow 11 save hang, runs
  // 6ad84f01/6ad85613): breadcrumb each await so the device log shows
  // exactly where this chain stops. Strip once the hang is explained.
  console.log(`[saveprobe] saveToPhotos enter ${uri}`);
  try {
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    console.log(`[saveprobe] permissions resolved granted=${perm.granted} status=${perm.status}`);
    if (!perm.granted) {
      return 'Photo saving is off. Allow “Add Photos Only” for Everytool in Settings → Privacy → Photos.';
    }
    await MediaLibrary.saveToLibraryAsync(uri);
    console.log('[saveprobe] saveToLibraryAsync resolved');
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
