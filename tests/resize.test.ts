import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimateOutputBytes,
  fitToMaxBytes,
  fitToMaxBytesAsync,
  fitWarning,
  limitLabel,
  outputSize,
  parseSizeTarget,
  PASSPORT_LIMITS,
  QUALITY_FLOOR,
  SIZE_CHIPS,
  type FitStep,
} from '../src/lib/resizePlan.ts';

/** Bigger quality and more pixels always cost more. Quality is ignored for the floor check when we want a pure area model. */
function areaBytes(step: FitStep): number {
  return step.width * step.height;
}

function qualityBytes(step: FitStep): number {
  return Math.round(step.quality * 100) * 1000;
}

test('size chips and passport limits are the portal numbers', () => {
  assert.deepEqual(
    SIZE_CHIPS.map((c) => c.bytes),
    [50 * 1024, 100 * 1024, 200 * 1024, 500 * 1024, 1024 * 1024, 2 * 1024 * 1024],
  );
  assert.equal(PASSPORT_LIMITS[0]!.bytes, 240 * 1024);
  assert.equal(PASSPORT_LIMITS[0]!.note.includes('under 240 KB'), true);
  assert.equal(PASSPORT_LIMITS[1]!.bytes, 100 * 1024);
  assert.equal(limitLabel(240 * 1024), '240 KB');
  assert.equal(limitLabel(1024 * 1024), '1 MB');
});

test('custom size parses KB and MB and rejects junk', () => {
  assert.equal(parseSizeTarget('240', 'KB'), 240 * 1024);
  assert.equal(parseSizeTarget('1.5', 'MB'), Math.round(1.5 * 1024 * 1024));
  assert.equal(parseSizeTarget('1,5', 'MB'), Math.round(1.5 * 1024 * 1024));
  assert.equal(parseSizeTarget('0', 'KB'), null);
  assert.equal(parseSizeTarget('-4', 'MB'), null);
  assert.equal(parseSizeTarget('nope', 'KB'), null);
  assert.equal(parseSizeTarget('', 'KB'), null);
});

test('output size stays on whole pixels and does not upscale', () => {
  assert.deepEqual(outputSize(2400, 1800, 1080), { width: 1080, height: 810 });
  assert.deepEqual(outputSize(800, 600, 1600), { width: 800, height: 600 });
  const sized = outputSize(1000, 333, 640);
  assert.equal(Number.isInteger(sized.width), true);
  assert.equal(Number.isInteger(sized.height), true);
});

test('estimate grows with JPEG quality, HEIC is smaller, PNG ignores quality', () => {
  const low = estimateOutputBytes(1200, 800, 0.4, 'jpeg');
  const high = estimateOutputBytes(1200, 800, 0.9, 'jpeg');
  assert.ok(high > low);
  assert.ok(estimateOutputBytes(1200, 800, 0.8, 'heic') < estimateOutputBytes(1200, 800, 0.8, 'jpeg'));
  assert.equal(
    estimateOutputBytes(100, 100, 0.4, 'png'),
    estimateOutputBytes(100, 100, 0.9, 'png'),
  );
});

test('size target: overlap found — highest quality that fits, dimensions kept', async () => {
  const seen: number[] = [];
  const plan = await fitToMaxBytes(
    {
      sourceWidth: 2400,
      sourceHeight: 1800,
      targetWidth: 1080,
      maxBytes: 70_000,
      format: 'jpeg',
      allowDownscale: true,
      preferredQuality: 0.92,
    },
    (step) => {
      seen.push(step.quality);
      assert.equal(step.width, 1080);
      assert.equal(step.height, 810);
      return qualityBytes(step);
    },
  );
  assert.equal(plan.unmet, false);
  assert.equal(plan.unmetAtDimensions, false);
  assert.equal(plan.downscaled, false);
  assert.equal(plan.width, 1080);
  assert.equal(plan.height, 810);
  assert.ok(plan.quality >= 0.69 && plan.quality <= 0.7, `quality ${plan.quality}`);
  assert.ok(plan.bytes <= 70_000);
  assert.ok(seen.every((q) => q >= QUALITY_FLOOR));
  assert.equal(fitWarning(plan, 1080, 70_000), null);
});

test('quality floor is not enough: downscale until the file fits', async () => {
  const plan = await fitToMaxBytes(
    {
      sourceWidth: 2000,
      sourceHeight: 2000,
      targetWidth: 2000,
      maxBytes: 100 * 1024,
      format: 'jpeg',
      allowDownscale: true,
    },
    (step) => areaBytes(step) + Math.round(step.quality * 100),
  );
  assert.equal(plan.unmetAtDimensions, true);
  assert.equal(plan.unmet, false);
  assert.equal(plan.downscaled, true);
  // Largest square whose floor encode is within 100 KB: 319² + 40.
  assert.equal(plan.width, 319);
  assert.equal(plan.height, 319);
  assert.ok(plan.bytes <= 100 * 1024);
  assert.equal(Number.isInteger(plan.width), true);
  assert.equal(Number.isInteger(plan.height), true);
  const warning = fitWarning(plan, 2000, 100 * 1024);
  assert.equal(
    warning,
    `2000 px wide stays above 100 KB even at the lowest quality. Export uses ${plan.width} × ${plan.height} instead.`,
  );
});

test('compress-only keeps dimensions and warns when the floor is still too big', async () => {
  const plan = await fitToMaxBytes(
    {
      sourceWidth: 2000,
      sourceHeight: 1500,
      targetWidth: null,
      maxBytes: 50 * 1024,
      format: 'jpeg',
      allowDownscale: false,
    },
    areaBytes,
  );
  assert.equal(plan.width, 2000);
  assert.equal(plan.height, 1500);
  assert.equal(plan.downscaled, false);
  assert.equal(plan.unmet, true);
  assert.equal(plan.unmetAtDimensions, true);
  assert.ok(plan.quality <= QUALITY_FLOOR + 0.001);
  assert.equal(fitWarning(plan, 2000, 50 * 1024), 'Can’t get under 50 KB at these dimensions.');
});

test('no size target keeps the requested dimensions', async () => {
  let calls = 0;
  const plan = await fitToMaxBytes(
    {
      sourceWidth: 2400,
      sourceHeight: 1800,
      targetWidth: 1600,
      maxBytes: null,
      format: 'jpeg',
      allowDownscale: true,
      preferredQuality: 0.7,
    },
    (step) => {
      calls += 1;
      assert.equal(step.width, 1600);
      assert.equal(step.height, 1200);
      assert.equal(step.quality, 0.7);
      return 400_000;
    },
  );
  assert.equal(calls, 1);
  assert.equal(plan.bytes, 400_000);
  assert.equal(plan.unmet, false);
  assert.equal(plan.downscaled, false);
});

test('PNG has no quality lever and downscales to meet the cap', async () => {
  const qualities: number[] = [];
  const plan = await fitToMaxBytes(
    {
      sourceWidth: 1000,
      sourceHeight: 1000,
      targetWidth: 1000,
      maxBytes: 40_000,
      format: 'png',
      allowDownscale: true,
    },
    (step) => {
      qualities.push(step.quality);
      return step.width * step.height;
    },
  );
  assert.ok(qualities.every((q) => q === 1));
  assert.equal(plan.quality, 1);
  assert.equal(plan.width, 200);
  assert.equal(plan.height, 200);
  assert.ok(plan.bytes <= 40_000);
  assert.equal(plan.unmet, false);
});

test('downscale stops at a 160 px long side and says the cap is impossible', async () => {
  const plan = await fitToMaxBytes(
    {
      sourceWidth: 1500,
      sourceHeight: 2000,
      targetWidth: 1500,
      maxBytes: 1024,
      format: 'jpeg',
      allowDownscale: true,
    },
    areaBytes,
  );
  assert.equal(plan.width, 120);
  assert.equal(plan.height, 160);
  assert.equal(plan.unmet, true);
  assert.equal(plan.downscaled, true);
  assert.equal(fitWarning(plan, 1500, 1024), 'Can’t get under 1 KB at these dimensions.');
});

test('async fit encodes each quality step once', async () => {
  const calls: string[] = [];
  const plan = await fitToMaxBytesAsync(
    {
      sourceWidth: 2400,
      sourceHeight: 1800,
      targetWidth: 1080,
      maxBytes: 70_000,
      format: 'jpeg',
      allowDownscale: true,
      preferredQuality: 0.92,
    },
    async (step) => {
      calls.push(`${step.width}x${step.height}@${step.quality}`);
      return qualityBytes(step);
    },
  );
  assert.equal(plan.width, 1080);
  assert.ok(plan.quality >= 0.69 && plan.quality <= 0.7);
  assert.equal(new Set(calls).size, calls.length);
  assert.ok(calls.length > 1);
});
