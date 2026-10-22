import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_PRESETS,
  PASSPORT_GROUP,
  PRESET_GROUPS,
  clampCrop,
  cropForFrame,
  faceGuideLayout,
  findPreset,
  frameOf,
  lengthToPx,
  lockedSide,
  parseCustomFrame,
  sheetPlan,
  youtubeSafeRect,
} from '../src/lib/resizePresets.ts';

const SOCIAL_IDS = [
  'facebook-profile',
  'facebook-cover',
  'facebook-post',
  'facebook-story',
  'instagram-profile',
  'instagram-post',
  'instagram-portrait',
  'instagram-story',
  'x-profile',
  'x-header',
  'x-post',
  'linkedin-profile',
  'linkedin-cover',
  'linkedin-company-cover',
  'linkedin-post',
  'youtube-profile',
  'youtube-banner',
  'youtube-thumbnail',
  'tiktok-profile',
  'tiktok-video',
  'whatsapp-profile',
  'whatsapp-status',
  'pinterest-profile',
  'pinterest-pin',
  'snapchat-profile',
  'snapchat-snap',
  'threads-profile',
  'threads-post',
] as const;

test('resize presets: each platform has the frames the spec names', () => {
  assert.deepEqual(
    PRESET_GROUPS.map((group) => group.label),
    [
      'Facebook',
      'Instagram',
      'X',
      'LinkedIn',
      'YouTube',
      'TikTok',
      'WhatsApp',
      'Pinterest',
      'Snapchat',
      'Threads',
    ],
  );
  const sizes = Object.fromEntries(ALL_PRESETS.map((preset) => [preset.id, [preset.width, preset.height]]));
  assert.deepEqual(
    SOCIAL_IDS.map((id) => sizes[id]),
    [
      [320, 320],
      [851, 315],
      [1080, 1080],
      [1080, 1920],
      [320, 320],
      [1080, 1080],
      [1080, 1350],
      [1080, 1920],
      [400, 400],
      [1500, 500],
      [1600, 900],
      [400, 400],
      [1584, 396],
      [1512, 256],
      [1080, 1080],
      [800, 800],
      [2560, 1440],
      [1280, 720],
      [200, 200],
      [1080, 1920],
      [640, 640],
      [1080, 1920],
      [280, 280],
      [1000, 1500],
      [320, 320],
      [1080, 1920],
      [320, 320],
      [1080, 1350],
    ],
  );
  assert.equal(new Set(ALL_PRESETS.map((preset) => preset.id)).size, ALL_PRESETS.length);
  for (const preset of ALL_PRESETS) {
    assert.equal(preset.source.startsWith('http'), true, preset.id);
    assert.equal(preset.width > 0 && preset.height > 0, true);
  }
});

test('resize presets: profile photos are circles, and the Facebook cover names its overlap', () => {
  for (const id of [
    'facebook-profile',
    'instagram-profile',
    'x-profile',
    'linkedin-profile',
    'youtube-profile',
    'tiktok-profile',
    'whatsapp-profile',
    'pinterest-profile',
    'snapchat-profile',
    'threads-profile',
  ]) {
    assert.equal(findPreset(id)?.overlay.kind, 'circle-mask', id);
  }
  const cover = findPreset('facebook-cover');
  assert.ok(cover);
  assert.equal(cover.overlay.kind, 'circle-overlap');
  if (cover.overlay.kind !== 'circle-overlap') return;
  assert.equal(cover.overlay.r, 88);
  assert.equal(cover.overlay.cx < cover.width / 3, true);
  assert.equal(cover.overlay.cy, cover.height);
  assert.equal(frameOf(cover).width, 851);
});

test('resize presets: YouTube safe area is the published minimum, scaled and centered', () => {
  const safe = youtubeSafeRect();
  assert.deepEqual(safe, { x: 508, y: 509, width: 1544, height: 423 });
  const banner = findPreset('youtube-banner');
  assert.equal(banner?.overlay.kind, 'safe-rect');
  if (banner?.overlay.kind !== 'safe-rect') return;
  assert.equal(banner.overlay.x, safe.x);
  assert.equal(banner.overlay.y, safe.y);
  assert.equal(safe.x + safe.width + safe.x, 2560);
  assert.equal(safe.y + safe.height <= 1440, true);
});

test('resize presets: passport frames are the print size at 300 dpi', () => {
  assert.equal(lengthToPx(2, 'in', 300), 600);
  assert.equal(lengthToPx(35, 'mm', 300), 413);
  assert.equal(lengthToPx(45, 'mm', 300), 531);
  assert.equal(lengthToPx(50, 'mm', 300), 591);
  assert.equal(lengthToPx(70, 'mm', 300), 827);
  assert.equal(lengthToPx(33, 'mm', 300), 390);
  assert.equal(lengthToPx(48, 'mm', 300), 567);
  assert.equal(lengthToPx(3.5, 'cm', 300), 413);

  const expectSize: Record<string, [number, number]> = {
    'passport-us': [600, 600],
    'passport-uk': [413, 531],
    'passport-schengen': [413, 531],
    'passport-india-square': [600, 600],
    'passport-india': [413, 531],
    'passport-pakistan': [413, 531],
    'passport-canada': [591, 827],
    'passport-china': [390, 567],
  };
  assert.deepEqual(
    PASSPORT_GROUP.presets.map((preset) => preset.id),
    Object.keys(expectSize),
  );
  for (const preset of PASSPORT_GROUP.presets) {
    assert.deepEqual([preset.width, preset.height], expectSize[preset.id]);
    assert.equal(preset.dpi, 300);
    assert.equal(preset.overlay.kind, 'face-guide');
    const guide = faceGuideLayout(preset);
    assert.ok(guide);
    assert.equal(guide.oval.y >= 0 && guide.oval.y + guide.oval.height <= 1, true);
    assert.equal(guide.oval.x >= 0, true);
  }

  const us = findPreset('passport-us');
  const usGuide = us ? faceGuideLayout(us) : null;
  assert.ok(usGuide?.eyeY != null);
  if (us?.overlay.kind === 'face-guide' && usGuide?.eyeY != null) {
    const fromBottom = 1 - usGuide.eyeY;
    assert.equal(fromBottom >= us.overlay.eyesFromBottom![0], true);
    assert.equal(fromBottom <= us.overlay.eyesFromBottom![1], true);
    assert.equal(usGuide.oval.height > us.overlay.headMin && usGuide.oval.height < us.overlay.headMax, true);
  }
});

test('resize presets: a 4×6 sheet holds each passport photo at full size', () => {
  const copies: Record<string, number> = {
    'passport-us': 2,
    'passport-uk': 6,
    'passport-schengen': 6,
    'passport-india-square': 2,
    'passport-india': 6,
    'passport-pakistan': 6,
    'passport-canada': 2,
    'passport-china': 4,
  };
  for (const [id, count] of Object.entries(copies)) {
    const plan = sheetPlan(findPreset(id)!);
    assert.ok(plan, id);
    assert.equal(plan.sheetWidth, 1200);
    assert.equal(plan.sheetHeight, 1800);
    assert.equal(plan.copies, count, id);
    assert.equal(plan.columns * plan.rows, plan.copies);
    const usedW = plan.columns * plan.photoWidth + (plan.columns - 1) * plan.gap;
    const usedH = plan.rows * plan.photoHeight + (plan.rows - 1) * plan.gap;
    assert.equal(usedW <= plan.sheetWidth - plan.margin * 2, true);
    assert.equal(usedH <= plan.sheetHeight - plan.margin * 2, true);
  }
  assert.equal(sheetPlan(findPreset('facebook-cover')!), null);
});

test('resize presets: custom size accepts px, mm, cm, and inches, and can lock aspect', () => {
  assert.deepEqual(parseCustomFrame({ width: '1080', height: '1350', unit: 'px', dpi: '' }), {
    width: 1080,
    height: 1350,
    dpi: 72,
  });
  assert.deepEqual(parseCustomFrame({ width: '35', height: '45', unit: 'mm', dpi: '' }), {
    width: 413,
    height: 531,
    dpi: 300,
  });
  assert.deepEqual(parseCustomFrame({ width: '3,5', height: '4.5', unit: 'cm', dpi: '300' }), {
    width: 413,
    height: 531,
    dpi: 300,
  });
  assert.deepEqual(parseCustomFrame({ width: '2', height: '2', unit: 'in', dpi: '300' }), {
    width: 600,
    height: 600,
    dpi: 300,
  });
  assert.equal(parseCustomFrame({ width: '0', height: '100', unit: 'px', dpi: '72' }), null);
  assert.equal(parseCustomFrame({ width: '10', height: '10', unit: 'mm', dpi: '0' }), null);
  assert.equal(parseCustomFrame({ width: 'nope', height: '10', unit: 'px', dpi: '72' }), null);

  const aspect = 1080 / 1350;
  assert.equal(lockedSide(800, aspect, 'width'), 1000);
  assert.equal(lockedSide(1000, aspect, 'height'), 800);
  assert.equal(lockedSide(0, aspect, 'width'), null);
});

test('resize presets: changing preset changes the frame, and the crop covers or fits', () => {
  const cover = findPreset('facebook-cover')!;
  const story = findPreset('instagram-story')!;
  assert.equal(cover.width / cover.height > 2, true);
  assert.equal(Math.abs(story.width / story.height - 9 / 16) < 1e-12, true);

  const source = { width: 4000, height: 3000 };
  const fill = cropForFrame(source, cover, 'fill');
  assert.ok(fill);
  assert.equal(Math.abs(fill.scale - 851 / 4000) < 1e-12, true);
  assert.equal(source.width * fill.scale >= cover.width, true);
  assert.equal(source.height * fill.scale >= cover.height, true);

  const fit = cropForFrame(source, cover, 'fit');
  assert.ok(fit);
  assert.equal(Math.abs(fit.scale - 315 / 3000) < 1e-12, true);
  assert.equal(source.width * fit.scale <= cover.width, true);
  assert.equal(source.height * fit.scale <= cover.height, true);

  const turned = cropForFrame(source, { width: 1080, height: 1920 }, 'fill', 90);
  assert.ok(turned);
  assert.equal(Math.abs(turned.scale - 1920 / 4000) < 1e-12, true);

  const clamped = clampCrop({ ...fill, offsetX: 5000, offsetY: -5000 }, source, cover);
  assert.equal(clamped.offsetX, 0);
  const slack = (source.height * fill.scale - cover.height) / 2;
  assert.equal(Math.abs(clamped.offsetY + slack) < 1e-9, true);
});
