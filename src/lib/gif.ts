import { File } from 'expo-file-system';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { decodePngRows } from './deflate';
import { tempFileUri } from './files';
import {
  encodeGif,
  GIF_FPS,
  GIF_MAX_SECONDS,
  GIF_WIDTH,
  quantizeFrame,
} from './gifenc';

// Video to GIF — plainly simplified, same as the mockup: frames are
// sampled off the clip with expo-video-thumbnails, quantized to a fixed
// 216-color cube palette, and encoded as a real GIF89a. No dithering.

export { encodeGif, GIF_FPS, GIF_MAX_SECONDS, GIF_WIDTH } from './gifenc';

export interface GifResult {
  uri: string;
  width: number;
  height: number;
  frames: number;
  bytes: number;
}

/**
 * Sample the first GIF_MAX_SECONDS of a video into a GIF. Frames come
 * from expo-video-thumbnails (JPEG stills at timestamps), decoded through
 * the PNG path is not possible for JPEG — so thumbnails are requested as
 * PNG-sized stills is not supported either; instead each thumbnail JPEG is
 * decoded by the platform into a PNG via ImageManipulator upstream.
 * Here we accept PNG frame URIs produced by the caller (the screen runs
 * each thumbnail through expo-image-manipulator to normalize to PNG).
 */
export async function makeGifFromVideo(
  videoUri: string,
  opts: {
    durationSec: number;
    toPng: (jpegUri: string) => Promise<{ uri: string; width: number; height: number }>;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<GifResult> {
  const seconds = Math.min(opts.durationSec || GIF_MAX_SECONDS, GIF_MAX_SECONDS);
  const total = Math.max(1, Math.floor(seconds * GIF_FPS));
  const frames: Uint8Array[] = [];
  let width = GIF_WIDTH;
  let height = 0;
  for (let i = 0; i < total; i += 1) {
    const timeMs = Math.round((i / GIF_FPS) * 1000);
    const thumb = await VideoThumbnails.getThumbnailAsync(videoUri, {
      time: timeMs,
      quality: 0.7,
    });
    const png = await opts.toPng(thumb.uri);
    const bytes = await new File(png.uri).bytes();
    let rgba = new Uint8Array(png.width * png.height * 4);
    decodePngRows(bytes, (y, row) => {
      rgba.set(row, y * png.width * 4);
    });
    // Downscale rows to GIF_WIDTH by nearest sampling if wider.
    if (png.width !== GIF_WIDTH) {
      const scale = GIF_WIDTH / png.width;
      const targetH = Math.max(2, Math.round(png.height * scale));
      const scaled = new Uint8Array(GIF_WIDTH * targetH * 4);
      for (let y = 0; y < targetH; y += 1) {
        const sy = Math.min(png.height - 1, Math.floor(y / scale));
        for (let x = 0; x < GIF_WIDTH; x += 1) {
          const sx = Math.min(png.width - 1, Math.floor(x / scale));
          const si = (sy * png.width + sx) * 4;
          const di = (y * GIF_WIDTH + x) * 4;
          scaled[di] = rgba[si] ?? 0;
          scaled[di + 1] = rgba[si + 1] ?? 0;
          scaled[di + 2] = rgba[si + 2] ?? 0;
          scaled[di + 3] = 255;
        }
      }
      rgba = scaled;
      width = GIF_WIDTH;
      height = targetH;
    } else {
      width = png.width;
      height = png.height;
    }
    frames.push(quantizeFrame(rgba));
    opts.onProgress?.(i + 1, total);
  }
  const gif = encodeGif(frames, width, height, Math.round(100 / GIF_FPS));
  const uri = tempFileUri('gif', 'everytool-gif');
  new File(uri).write(gif);
  return { uri, width, height, frames: frames.length, bytes: gif.length };
}
