import { File, Paths } from 'expo-file-system';
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

export async function shareFile(uri: string, mimeType: string): Promise<void> {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType });
  }
}
