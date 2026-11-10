export interface ImageSource {
  uri: string;
  name?: string;
  width: number;
  height: number;
  measurementFailed?: boolean;
}

/** A failed measurement is terminal for this source, until it is picked again. */
export async function measureSources(
  sources: ImageSource[],
  measure: (uri: string) => Promise<{ width: number; height: number }>,
): Promise<ImageSource[]> {
  return Promise.all(sources.map(async (source) => {
    if (source.measurementFailed || (source.width > 0 && source.height > 0)) return source;
    try {
      const size = await measure(source.uri);
      if (size.width > 0 && size.height > 0) return { ...source, ...size };
    } catch {
      // A missing/corrupt shared file is a recoverable input error.
    }
    return { ...source, measurementFailed: true };
  }));
}
