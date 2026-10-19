import { File, FileMode, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { decodePngRows, PngStreamWriter } from './deflate';
import { planStitch, stitchWidth, type Size } from './stitchMath';

export interface ShotInput {
  uri: string;
  width: number;
  height: number;
}

export interface StitchResult {
  uri: string;
  width: number;
  height: number;
  /** At least one seam had no credible overlap — shots were stacked whole. */
  stacked: boolean;
  /** The strip was shrunk to fit the 8192px height cap. */
  capped: boolean;
}

// ---------------------------------------------------------------------------
// Seam matching on 96px grayscale thumbnails (the mockup's approach):
// slide the next shot's top over the running image's bottom and score the
// mean absolute difference. Below-threshold scores mean "no overlap" and
// are reported, never hidden.
// ---------------------------------------------------------------------------

interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
}

const thumbCache = new Map<string, Promise<Gray>>();

function toGray(uri: string): Promise<Gray> {
  const hit = thumbCache.get(uri);
  if (hit) return hit;
  const promise = (async () => {
    const thumb = await manipulateAsync(uri, [{ resize: { width: 96 } }], {
      format: SaveFormat.PNG,
    });
    const bytes = await new File(thumb.uri).bytes();
    const rows: Uint8Array[] = [];
    decodePngRows(bytes, (_y, rgba) => {
      const g = new Uint8Array(thumb.width);
      for (let x = 0; x < thumb.width; x += 1) {
        const i = x * 4;
        g[x] = Math.round(
          ((rgba[i] ?? 0) + (rgba[i + 1] ?? 0) + (rgba[i + 2] ?? 0)) / 3,
        );
      }
      rows.push(g);
    });
    const data = new Uint8Array(thumb.width * rows.length);
    rows.forEach((r, y) => data.set(r, y * thumb.width));
    return { width: thumb.width, height: rows.length, data };
  })();
  thumbCache.set(uri, promise);
  return promise;
}

/** Overlap between the running image and the next shot, in thumbnail rows. */
async function findOverlapRows(
  accUri: string,
  nextUri: string,
): Promise<number> {
  const [top, next] = await Promise.all([toGray(accUri), toGray(nextUri)]);
  if (top.width !== next.width || top.height === 0 || next.height === 0) {
    return 0;
  }
  const at = (p: Gray, x: number, y: number) => p.data[y * p.width + x] ?? 0;
  const maxOverlap = Math.min(top.height, next.height) - 8;
  const minOverlap = 4;
  if (maxOverlap <= minOverlap) return 0;
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let o = minOverlap; o <= maxOverlap; o += 1) {
    const band = Math.min(14, o);
    let diff = 0;
    let n = 0;
    for (let y = 0; y < band; y += 1) {
      for (let x = 2; x < top.width - 2; x += 2) {
        diff += Math.abs(at(top, x, top.height - o + y) - at(next, x, y));
        n += 1;
      }
    }
    const score = n > 0 ? diff / n : Number.POSITIVE_INFINITY;
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return bestScore < 16 ? best : 0;
}

// ---------------------------------------------------------------------------
// The stitch: normalize to plan width, then stream rows into one PNG.
// ---------------------------------------------------------------------------

export async function stitchShots(shots: ShotInput[]): Promise<StitchResult> {
  if (shots.length < 2) throw new Error('Add at least two shots to stitch.');
  const sizes: Size[] = shots.map((s) => ({ width: s.width, height: s.height }));
  const width = stitchWidth(sizes);

  // EVERY shot is re-encoded to PNG at plan width — including one whose
  // width already matches. Picker originals are often HEIC/JPEG, and the
  // row decoder below only speaks PNG; the re-encode is the guarantee,
  // not just a resize.
  const normalized: ShotInput[] = [];
  for (const shot of shots) {
    const r = await manipulateAsync(shot.uri, [{ resize: { width } }], {
      format: SaveFormat.PNG,
    });
    normalized.push({ uri: r.uri, width: r.width, height: r.height });
  }

  // Resolve every seam before writing, so the plan (and the height cap)
  // is known up front.
  const overlaps: number[] = [];
  let stacked = false;
  let accUri = normalized[0]?.uri ?? '';
  let accHeight = normalized[0]?.height ?? 0;
  for (let i = 1; i < normalized.length; i += 1) {
    const next = normalized[i];
    if (!next) continue;
    const accThumb = await toGray(accUri);
    const rows = await findOverlapRows(accUri, next.uri);
    const overlapPx =
      accThumb.height > 0 ? Math.round((rows * accHeight) / accThumb.height) : 0;
    const clamped = Math.max(0, Math.min(overlapPx, next.height - 1));
    if (clamped <= 0) stacked = true;
    overlaps.push(clamped);
    accUri = next.uri;
    accHeight = next.height;
  }

  const plan = planStitch(
    normalized.map((s) => ({ width: s.width, height: s.height })),
    overlaps,
  );

  const outName = `stitch-${Date.now().toString(36)}.png`;
  const outFile = new File(Paths.cache, outName);
  if (outFile.exists) outFile.delete();
  outFile.create();
  const handle = outFile.open(FileMode.WriteOnly);
  const sink = {
    write: (bytes: Uint8Array) => {
      handle.writeBytes(bytes);
    },
  };
  try {
    const writer = new PngStreamWriter(sink, plan.width, plan.naturalHeight);
    for (let i = 0; i < normalized.length; i += 1) {
      const shot = normalized[i];
      if (!shot) continue;
      const skip = i === 0 ? 0 : overlaps[i - 1] ?? 0;
      const bytes = await new File(shot.uri).bytes();
      decodePngRows(bytes, (y, rgba) => {
        if (y >= skip) writer.writeRow(rgba);
      });
    }
    writer.finish();
  } finally {
    handle.close();
  }

  let outUri = outFile.uri;
  let outWidth = plan.width;
  let outHeight = plan.naturalHeight;
  if (plan.capped) {
    const r = await manipulateAsync(outUri, [
      { resize: { width: plan.outWidth } },
    ], { format: SaveFormat.PNG });
    outUri = r.uri;
    outWidth = r.width;
    outHeight = r.height;
  }
  return {
    uri: outUri,
    width: outWidth,
    height: outHeight,
    stacked: stacked || plan.stacked,
    capped: plan.capped,
  };
}

/**
 * Assemble frames the broadcast extension left in the App Group inbox.
 * The extension writes plain frames in capture order — it records no
 * scroll offsets — so a multi-frame recording goes through the same
 * content-overlap pipeline as picked screenshots. A single frame IS
 * the screenshot; hand it back untouched.
 */
export async function stitchRecordedFrames(
  frames: { uri: string; width: number; height: number }[],
): Promise<StitchResult> {
  if (frames.length === 0) throw new Error('No frames were recorded.');
  const only = frames[0];
  if (frames.length === 1 && only) {
    return {
      uri: only.uri,
      width: only.width,
      height: only.height,
      stacked: false,
      capped: false,
    };
  }
  return stitchShots(
    frames.map((f) => ({ uri: f.uri, width: f.width, height: f.height })),
  );
}
