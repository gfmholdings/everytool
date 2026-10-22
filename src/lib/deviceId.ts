import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'everytool.device-id.v1';

let cached: string | null = null;

/** Stable id for this install. Group-file merges use it to break ties. */
export async function loadDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored && stored.length > 0) {
      cached = stored;
      return stored;
    }
  } catch {
    // Mint one below. The next successful write makes it stable.
  }
  const id = `ios-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  cached = id;
  try {
    await AsyncStorage.setItem(KEY, id);
  } catch {
    // Still stable for this process.
  }
  return id;
}
