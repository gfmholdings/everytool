// Preset frames for the Resize tool. Pure data and crop math. The screen
// still uses its own width chips; nothing here is wired to the UI yet.
//
// Pixel sizes are the upload frames each platform documents, or the print
// size at 300 dpi for passport photos. Where a platform does not publish a
// single number, the `source` on that preset says which guide the frame
// follows. Checked October 2026.

export const SOCIAL_DPI = 72;
export const PRINT_DPI = 300;
export const PRINT_SHEET_IN = { width: 4, height: 6 } as const;

export type LengthUnit = 'px' | 'mm' | 'cm' | 'in';
export type PresetKind = 'social' | 'passport';
export type CropMode = 'fill' | 'fit';

export type FrameOverlay =
  | { kind: 'none' }
  | { kind: 'circle-mask' }
  | {
      kind: 'circle-overlap';
      /** Center and radius in export pixels. The part inside the frame is covered on the platform. */
      cx: number;
      cy: number;
      r: number;
      label: string;
    }
  | {
      kind: 'safe-rect';
      x: number;
      y: number;
      width: number;
      height: number;
      label: string;
    }
  | {
      kind: 'face-guide';
      /** Chin-to-crown, as a fraction of the photo height. */
      headMin: number;
      headMax: number;
      /** Eyes measured up from the bottom edge, as a fraction of the photo height. */
      eyesFromBottom: readonly [number, number] | null;
      label: string;
    };

export interface ResizePreset {
  id: string;
  platformId: string;
  platform: string;
  label: string;
  width: number;
  height: number;
  dpi: number;
  kind: PresetKind;
  overlay: FrameOverlay;
  note: string;
  source: string;
}

export interface PresetGroup {
  id: string;
  label: string;
  presets: readonly ResizePreset[];
}

export interface PhotoSize {
  width: number;
  height: number;
}

export interface PhotoCrop {
  /** Source pixels → frame pixels, before rotation is applied to the source. */
  scale: number;
  /** Clockwise degrees. */
  rotation: number;
  /** Source center minus frame center, in frame pixels. */
  offsetX: number;
  offsetY: number;
}

export interface CustomFrame {
  width: number;
  height: number;
  dpi: number;
}

export interface SheetPlan {
  sheetWidth: number;
  sheetHeight: number;
  dpi: number;
  margin: number;
  gap: number;
  columns: number;
  rows: number;
  copies: number;
  photoWidth: number;
  photoHeight: number;
}

export interface FaceGuideLayout {
  oval: { x: number; y: number; width: number; height: number };
  /** Eye line measured from the top, as a fraction of the photo height. */
  eyeY: number | null;
}

const FB_HELP = 'https://www.facebook.com/help/125379114252045';
const FB_COVER_W = 851;
const FB_COVER_H = 315;
/** Desktop display size of the Page profile picture, from the same Facebook Help article. */
const FB_PROFILE_DISPLAY = 176;
const HOOTSUITE_2026 = 'https://blog.hootsuite.com/social-media-image-sizes-guide/';
const SPROUT_2026 = 'https://sproutsocial.com/insights/social-media-image-sizes-guide/';
const LI_PROFILE = 'https://www.linkedin.com/help/linkedin/answer/a549049';
const LI_PAGE = 'https://www.linkedin.com/help/linkedin/answer/a563309';
const LI_SHARE = 'https://www.linkedin.com/help/linkedin/answer/a527229';
const YT_BRAND = 'https://support.google.com/youtube/answer/10456525';
const YT_MIN_W = 2048;
const YT_MIN_H = 1152;
/** Safe area YouTube Help gives at the minimum banner size. */
const YT_MIN_SAFE_W = 1235;
const YT_MIN_SAFE_H = 338;
const YT_BANNER_W = 2560;
const YT_BANNER_H = 1440;
const US_PHOTOS = 'https://travel.state.gov/content/travel/en/passports/how-apply/photos.html';
const UK_PHOTOS = 'https://www.gov.uk/photos-for-passports';
const CA_PHOTOS =
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/canadian-passports/photos.html';

export function lengthToPx(value: number, unit: LengthUnit, dpi: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit !== 'px' && (!Number.isFinite(dpi) || dpi <= 0)) return null;
  const px =
    unit === 'px'
      ? value
      : unit === 'in'
        ? value * dpi
        : unit === 'cm'
          ? (value / 2.54) * dpi
          : (value / 25.4) * dpi;
  const rounded = Math.round(px);
  if (rounded < 1 || rounded > 20_000) return null;
  return rounded;
}

function social(
  partial: Omit<ResizePreset, 'kind' | 'dpi' | 'overlay'> & { overlay?: FrameOverlay },
): ResizePreset {
  return { dpi: SOCIAL_DPI, kind: 'social', overlay: { kind: 'none' }, ...partial };
}

function passport(
  partial: Omit<ResizePreset, 'kind' | 'dpi' | 'platformId' | 'platform'> & { platform?: string },
): ResizePreset {
  return {
    platformId: 'passport',
    platform: partial.platform ?? 'Passport',
    dpi: PRINT_DPI,
    kind: 'passport',
    ...partial,
  };
}

function circle(): FrameOverlay {
  return { kind: 'circle-mask' };
}

function face(
  headMinMm: number,
  headMaxMm: number,
  photoHeightMm: number,
  eyesFromBottom: readonly [number, number] | null,
  label: string,
): FrameOverlay {
  return {
    kind: 'face-guide',
    headMin: headMinMm / photoHeightMm,
    headMax: headMaxMm / photoHeightMm,
    eyesFromBottom,
    label,
  };
}

/** YouTube's minimum safe area placed on the recommended 2560×1440 banner. */
export function youtubeSafeRect(): { x: number; y: number; width: number; height: number } {
  const width = Math.round(YT_MIN_SAFE_W * (YT_BANNER_W / YT_MIN_W));
  const height = Math.round(YT_MIN_SAFE_H * (YT_BANNER_H / YT_MIN_H));
  return {
    width,
    height,
    x: Math.round((YT_BANNER_W - width) / 2),
    y: Math.round((YT_BANNER_H - height) / 2),
  };
}

const youtubeSafe = youtubeSafeRect();

/**
 * Facebook cover, 851×315.
 * The Page profile picture displays at 176×176 on a computer and covers the
 * lower left of the cover (Facebook Help). The circle sits on the bottom
 * edge so the upper half is the overlap.
 */
const facebookCoverOverlap: FrameOverlay = {
  kind: 'circle-overlap',
  r: FB_PROFILE_DISPLAY / 2,
  cx: 16 + FB_PROFILE_DISPLAY / 2,
  cy: FB_COVER_H,
  label: 'Profile photo covers this',
};

export const PRESET_GROUPS: readonly PresetGroup[] = [
  {
    id: 'facebook',
    label: 'Facebook',
    presets: [
      social({
        id: 'facebook-profile',
        platformId: 'facebook',
        platform: 'Facebook',
        label: 'Profile',
        width: 320,
        height: 320,
        overlay: circle(),
        note: 'Upload 320×320. Facebook shows it as a circle (176 px on a computer, 196 px on a phone).',
        source: FB_HELP,
      }),
      social({
        id: 'facebook-cover',
        platformId: 'facebook',
        platform: 'Facebook',
        label: 'Cover',
        width: FB_COVER_W,
        height: FB_COVER_H,
        overlay: facebookCoverOverlap,
        note: '851×315 loads fastest. Minimum is 400×150. The profile picture covers the lower left.',
        source: FB_HELP,
      }),
      social({
        id: 'facebook-post',
        platformId: 'facebook',
        platform: 'Facebook',
        label: 'Post',
        width: 1080,
        height: 1080,
        note: 'Square feed post. Facebook Help does not publish one post size; 1080×1080 is the frame that stays square on phones and computers.',
        source: HOOTSUITE_2026,
      }),
      social({
        id: 'facebook-story',
        platformId: 'facebook',
        platform: 'Facebook',
        label: 'Story',
        width: 1080,
        height: 1920,
        note: 'Full-screen story, 9:16.',
        source: HOOTSUITE_2026,
      }),
    ],
  },
  {
    id: 'instagram',
    label: 'Instagram',
    presets: [
      social({
        id: 'instagram-profile',
        platformId: 'instagram',
        platform: 'Instagram',
        label: 'Profile',
        width: 320,
        height: 320,
        overlay: circle(),
        note: 'Stored at 320×320 and shown as a circle.',
        source: HOOTSUITE_2026,
      }),
      social({
        id: 'instagram-post',
        platformId: 'instagram',
        platform: 'Instagram',
        label: 'Square post',
        width: 1080,
        height: 1080,
        note: 'Feed post, 1:1. Instagram keeps a width of 1080.',
        source: HOOTSUITE_2026,
      }),
      social({
        id: 'instagram-portrait',
        platformId: 'instagram',
        platform: 'Instagram',
        label: 'Portrait',
        width: 1080,
        height: 1350,
        note: 'Tallest feed post, 4:5.',
        source: HOOTSUITE_2026,
      }),
      social({
        id: 'instagram-story',
        platformId: 'instagram',
        platform: 'Instagram',
        label: 'Story / Reel',
        width: 1080,
        height: 1920,
        note: 'Story and Reel frame, 9:16.',
        source: HOOTSUITE_2026,
      }),
    ],
  },
  {
    id: 'x',
    label: 'X',
    presets: [
      social({
        id: 'x-profile',
        platformId: 'x',
        platform: 'X',
        label: 'Profile',
        width: 400,
        height: 400,
        overlay: circle(),
        note: 'Profile photo, 400×400, shown as a circle.',
        source: `${HOOTSUITE_2026} ${SPROUT_2026}`,
      }),
      social({
        id: 'x-header',
        platformId: 'x',
        platform: 'X',
        label: 'Header',
        width: 1500,
        height: 500,
        note: 'Header photo, 1500×500. About 60 px can crop from the top and bottom depending on the screen.',
        source: HOOTSUITE_2026,
      }),
      social({
        id: 'x-post',
        platformId: 'x',
        platform: 'X',
        label: 'Post',
        width: 1600,
        height: 900,
        note: 'In-feed post, 16:9. X does not publish one organic post size; this is the primary post frame in the 2026 size guides.',
        source: SPROUT_2026,
      }),
    ],
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    presets: [
      social({
        id: 'linkedin-profile',
        platformId: 'linkedin',
        platform: 'LinkedIn',
        label: 'Profile',
        width: 400,
        height: 400,
        overlay: circle(),
        note: 'Recommended profile photo is at least 400×400. LinkedIn accepts up to 7680×4320.',
        source: LI_PROFILE,
      }),
      social({
        id: 'linkedin-cover',
        platformId: 'linkedin',
        platform: 'LinkedIn',
        label: 'Cover',
        width: 1584,
        height: 396,
        note: 'Personal background photo, 1584×396.',
        source: LI_PROFILE,
      }),
      social({
        id: 'linkedin-company-cover',
        platformId: 'linkedin',
        platform: 'LinkedIn',
        label: 'Company cover',
        width: 1512,
        height: 256,
        note: 'Company Page cover. LinkedIn Help lists 1512×256 as the recommended size.',
        source: LI_PAGE,
      }),
      social({
        id: 'linkedin-post',
        platformId: 'linkedin',
        platform: 'LinkedIn',
        label: 'Post',
        width: 1080,
        height: 1080,
        note: 'Square photo post. LinkedIn recommends a width of 1080. Allowed ratios run from 3:1 to 4:5.',
        source: LI_SHARE,
      }),
    ],
  },
  {
    id: 'youtube',
    label: 'YouTube',
    presets: [
      social({
        id: 'youtube-profile',
        platformId: 'youtube',
        platform: 'YouTube',
        label: 'Profile',
        width: 800,
        height: 800,
        overlay: circle(),
        note: 'Channel picture, shown as a circle. YouTube Help does not publish one upload size; 800×800 stays sharp at the small display size.',
        source: `${YT_BRAND} ${SPROUT_2026}`,
      }),
      social({
        id: 'youtube-banner',
        platformId: 'youtube',
        platform: 'YouTube',
        label: 'Banner',
        width: YT_BANNER_W,
        height: YT_BANNER_H,
        overlay: {
          kind: 'safe-rect',
          ...youtubeSafe,
          label: 'Visible on every screen',
        },
        note: 'Channel banner. Recommended 2560×1440 (minimum 2048×1152). The safe rectangle is YouTube’s 1235×338 area scaled onto that banner.',
        source: YT_BRAND,
      }),
      social({
        id: 'youtube-thumbnail',
        platformId: 'youtube',
        platform: 'YouTube',
        label: 'Thumbnail',
        width: 1280,
        height: 720,
        note: 'Video thumbnail, 1280×720. Minimum width is 640 px.',
        source: HOOTSUITE_2026,
      }),
    ],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    presets: [
      social({
        id: 'tiktok-profile',
        platformId: 'tiktok',
        platform: 'TikTok',
        label: 'Profile',
        width: 200,
        height: 200,
        overlay: circle(),
        note: 'Recommended profile photo is 200×200. Minimum upload is 20×20.',
        source: HOOTSUITE_2026,
      }),
      social({
        id: 'tiktok-video',
        platformId: 'tiktok',
        platform: 'TikTok',
        label: 'Video',
        width: 1080,
        height: 1920,
        note: 'Video and photo post, 9:16.',
        source: HOOTSUITE_2026,
      }),
    ],
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    presets: [
      social({
        id: 'whatsapp-profile',
        platformId: 'whatsapp',
        platform: 'WhatsApp',
        label: 'Profile',
        width: 640,
        height: 640,
        overlay: circle(),
        note: 'WhatsApp does not publish a profile pixel size. It shows a circle. 640×640 is the export so that circle stays sharp.',
        source: HOOTSUITE_2026,
      }),
      social({
        id: 'whatsapp-status',
        platformId: 'whatsapp',
        platform: 'WhatsApp',
        label: 'Status',
        width: 1080,
        height: 1920,
        note: 'Status frame, 9:16. WhatsApp does not publish a status pixel size; this is the full-screen phone frame.',
        source: HOOTSUITE_2026,
      }),
    ],
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    presets: [
      social({
        id: 'pinterest-profile',
        platformId: 'pinterest',
        platform: 'Pinterest',
        label: 'Profile',
        width: 280,
        height: 280,
        overlay: circle(),
        note: 'Recommended upload is 280×280. Pinterest displays it as a 165 px circle.',
        source: SPROUT_2026,
      }),
      social({
        id: 'pinterest-pin',
        platformId: 'pinterest',
        platform: 'Pinterest',
        label: 'Pin',
        width: 1000,
        height: 1500,
        note: 'Standard Pin, 2:3, 1000×1500.',
        source: `${HOOTSUITE_2026} ${SPROUT_2026}`,
      }),
    ],
  },
  {
    id: 'snapchat',
    label: 'Snapchat',
    presets: [
      social({
        id: 'snapchat-profile',
        platformId: 'snapchat',
        platform: 'Snapchat',
        label: 'Profile',
        width: 320,
        height: 320,
        overlay: circle(),
        note: 'Profile photo, 320×320, shown as a circle.',
        source: HOOTSUITE_2026,
      }),
      social({
        id: 'snapchat-snap',
        platformId: 'snapchat',
        platform: 'Snapchat',
        label: 'Snap',
        width: 1080,
        height: 1920,
        note: 'Full-screen snap, 9:16. Keep type out of the top and bottom bands the app covers.',
        source: HOOTSUITE_2026,
      }),
    ],
  },
  {
    id: 'threads',
    label: 'Threads',
    presets: [
      social({
        id: 'threads-profile',
        platformId: 'threads',
        platform: 'Threads',
        label: 'Profile',
        width: 320,
        height: 320,
        overlay: circle(),
        note: 'Threads can use the Instagram profile photo. Shown as a circle. Recommended upload 320×320.',
        source: SPROUT_2026,
      }),
      social({
        id: 'threads-post',
        platformId: 'threads',
        platform: 'Threads',
        label: 'Post',
        width: 1080,
        height: 1350,
        note: 'Vertical post, 4:5. Threads also accepts a sharper 4:5 file; this frame matches the Instagram portrait size.',
        source: SPROUT_2026,
      }),
    ],
  },
];

export const PASSPORT_GROUP: PresetGroup = {
  id: 'passport',
  label: 'Passport & ID',
  presets: [
    passport({
      id: 'passport-us',
      label: 'US passport',
      width: lengthToPx(2, 'in', PRINT_DPI) ?? 0,
      height: lengthToPx(2, 'in', PRINT_DPI) ?? 0,
      overlay: face(1, 1.375, 2, [1.125 / 2, 1.375 / 2], 'Chin to crown 1–1⅜ in. Eyes 1⅛–1⅜ in from the bottom.'),
      note: '2×2 in at 300 dpi (600×600). White or off-white background.',
      source: US_PHOTOS,
    }),
    passport({
      id: 'passport-uk',
      label: 'UK passport',
      width: lengthToPx(35, 'mm', PRINT_DPI) ?? 0,
      height: lengthToPx(45, 'mm', PRINT_DPI) ?? 0,
      overlay: face(29, 34, 45, null, 'Chin to crown 29–34 mm.'),
      note: '35×45 mm at 300 dpi. Plain light background.',
      source: UK_PHOTOS,
    }),
    passport({
      id: 'passport-schengen',
      label: 'EU / Schengen',
      width: lengthToPx(35, 'mm', PRINT_DPI) ?? 0,
      height: lengthToPx(45, 'mm', PRINT_DPI) ?? 0,
      overlay: face(32, 36, 45, null, 'Chin to crown about 32–36 mm.'),
      note: '35×45 mm biometric photo at 300 dpi.',
      source: 'https://home-affairs.ec.europa.eu/policies/schengen-borders-and-visa/visa-policy_en',
    }),
    passport({
      id: 'passport-india-square',
      label: 'India 2×2',
      width: lengthToPx(2, 'in', PRINT_DPI) ?? 0,
      height: lengthToPx(2, 'in', PRINT_DPI) ?? 0,
      overlay: face(1, 1.375, 2, [1.125 / 2, 1.375 / 2], 'Square 2×2 in. Head guide matches the 2×2 in visa photo.'),
      note: '2×2 in at 300 dpi, for channels that ask for a square photo (visa, OCI).',
      source: 'https://www.passportindia.gov.in/',
    }),
    passport({
      id: 'passport-india',
      label: 'India 35×45',
      width: lengthToPx(35, 'mm', PRINT_DPI) ?? 0,
      height: lengthToPx(45, 'mm', PRINT_DPI) ?? 0,
      overlay: face(31.5, 36, 45, null, 'Head guide, about 70–80% of the photo.'),
      note: '35×45 mm at 300 dpi, the Passport Seva print size. Plain light background.',
      source: 'https://www.passportindia.gov.in/',
    }),
    passport({
      id: 'passport-pakistan',
      label: 'Pakistan',
      width: lengthToPx(35, 'mm', PRINT_DPI) ?? 0,
      height: lengthToPx(45, 'mm', PRINT_DPI) ?? 0,
      overlay: face(32, 36, 45, null, '35×45 mm. Head guide for a biometric photo of this size.'),
      note: '35×45 mm at 300 dpi.',
      source: 'https://dgip.gov.pk/',
    }),
    passport({
      id: 'passport-canada',
      label: 'Canada',
      width: lengthToPx(50, 'mm', PRINT_DPI) ?? 0,
      height: lengthToPx(70, 'mm', PRINT_DPI) ?? 0,
      overlay: face(31, 36, 70, null, 'Chin to crown 31–36 mm.'),
      note: '50×70 mm at 300 dpi (2 × 2¾ in). Plain white or light background.',
      source: CA_PHOTOS,
    }),
    passport({
      id: 'passport-china',
      label: 'China',
      width: lengthToPx(33, 'mm', PRINT_DPI) ?? 0,
      height: lengthToPx(48, 'mm', PRINT_DPI) ?? 0,
      overlay: face(28, 33, 48, null, 'Chin to crown 28–33 mm.'),
      note: '33×48 mm at 300 dpi. White or close to white background.',
      source: 'https://www.nia.gov.cn/',
    }),
  ],
};

export const ALL_PRESETS: readonly ResizePreset[] = [
  ...PRESET_GROUPS.flatMap((group) => group.presets),
  ...PASSPORT_GROUP.presets,
];

export function findPreset(id: string): ResizePreset | null {
  return ALL_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function frameOf(preset: ResizePreset): PhotoSize & { dpi: number } {
  return { width: preset.width, height: preset.height, dpi: preset.dpi };
}

function parseMeasure(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return value;
}

/**
 * Width and height in px, mm, cm, or inches. Physical units use DPI
 * (300 when the field is empty). Pixels ignore DPI.
 */
export function parseCustomFrame(input: {
  width: string;
  height: string;
  unit: LengthUnit;
  dpi: string;
}): CustomFrame | null {
  const dpiText = input.dpi.trim().replace(',', '.');
  const dpi = dpiText ? Number(dpiText) : input.unit === 'px' ? SOCIAL_DPI : PRINT_DPI;
  if (!Number.isFinite(dpi) || dpi < 36 || dpi > 2400) return null;
  const widthValue = parseMeasure(input.width);
  const heightValue = parseMeasure(input.height);
  if (widthValue == null || heightValue == null) return null;
  const width = lengthToPx(widthValue, input.unit, dpi);
  const height = lengthToPx(heightValue, input.unit, dpi);
  if (width == null || height == null) return null;
  return { width, height, dpi };
}

/** The other side, in pixels, when aspect is locked. `aspect` is width ÷ height. */
export function lockedSide(
  editedPx: number,
  aspect: number,
  changed: 'width' | 'height',
): number | null {
  if (!Number.isFinite(editedPx) || editedPx <= 0) return null;
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  const other = changed === 'width' ? editedPx / aspect : editedPx * aspect;
  const rounded = Math.round(other);
  if (rounded < 1 || rounded > 20_000) return null;
  return rounded;
}

function normalizeRotation(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return ((degrees % 360) + 360) % 360;
}

export function rotatedBounds(width: number, height: number, degrees: number): PhotoSize {
  const rad = (normalizeRotation(degrees) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return { width: width * c + height * s, height: width * s + height * c };
}

/** Scale that fills the frame, or fits the whole photo inside it. Offset starts at center. */
export function cropForFrame(
  source: PhotoSize,
  frame: PhotoSize,
  mode: CropMode,
  rotation = 0,
): PhotoCrop | null {
  if (source.width <= 0 || source.height <= 0 || frame.width <= 0 || frame.height <= 0) return null;
  const box = rotatedBounds(source.width, source.height, rotation);
  if (box.width <= 0 || box.height <= 0) return null;
  const scale =
    mode === 'fill'
      ? Math.max(frame.width / box.width, frame.height / box.height)
      : Math.min(frame.width / box.width, frame.height / box.height);
  return { scale, rotation: normalizeRotation(rotation), offsetX: 0, offsetY: 0 };
}

/** Keep a fill crop covering the frame, and keep a fit crop inside the frame. */
export function clampCrop(crop: PhotoCrop, source: PhotoSize, frame: PhotoSize): PhotoCrop {
  const box = rotatedBounds(source.width, source.height, crop.rotation);
  const drawnW = box.width * crop.scale;
  const drawnH = box.height * crop.scale;
  const limitX = Math.abs(drawnW - frame.width) / 2;
  const limitY = Math.abs(drawnH - frame.height) / 2;
  return {
    ...crop,
    offsetX: Math.min(limitX, Math.max(-limitX, crop.offsetX)),
    offsetY: Math.min(limitY, Math.max(-limitY, crop.offsetY)),
  };
}

function countAlong(space: number, cell: number, gap: number): number {
  if (cell <= 0 || cell > space) return 0;
  return Math.floor((space + gap) / (cell + gap));
}

/** How many copies of a passport photo fit on a 4×6 in sheet at 300 dpi. */
export function sheetPlan(preset: ResizePreset, marginMm = 4, gapMm = 3): SheetPlan | null {
  if (preset.kind !== 'passport') return null;
  if (preset.dpi !== PRINT_DPI) return null;
  const margin = lengthToPx(marginMm, 'mm', PRINT_DPI);
  const gap = lengthToPx(gapMm, 'mm', PRINT_DPI);
  const sheetWidth = lengthToPx(PRINT_SHEET_IN.width, 'in', PRINT_DPI);
  const sheetHeight = lengthToPx(PRINT_SHEET_IN.height, 'in', PRINT_DPI);
  if (margin == null || gap == null || sheetWidth == null || sheetHeight == null) return null;
  const usableW = sheetWidth - margin * 2;
  const usableH = sheetHeight - margin * 2;
  const columns = countAlong(usableW, preset.width, gap);
  const rows = countAlong(usableH, preset.height, gap);
  return {
    sheetWidth,
    sheetHeight,
    dpi: PRINT_DPI,
    margin,
    gap,
    columns,
    rows,
    copies: columns * rows,
    photoWidth: preset.width,
    photoHeight: preset.height,
  };
}

/** Oval and eye line for a passport preset, in fractions of the frame. */
export function faceGuideLayout(preset: ResizePreset): FaceGuideLayout | null {
  if (preset.overlay.kind !== 'face-guide') return null;
  const { headMin, headMax, eyesFromBottom } = preset.overlay;
  const headH = (headMin + headMax) / 2;
  const headWFrac = (headH * preset.height * 0.72) / preset.width;
  const ovalW = Math.min(0.86, headWFrac);
  const ovalX = (1 - ovalW) / 2;
  let ovalY: number;
  let eyeY: number | null = null;
  if (eyesFromBottom) {
    eyeY = 1 - (eyesFromBottom[0] + eyesFromBottom[1]) / 2;
    ovalY = eyeY - headH * 0.4;
  } else {
    ovalY = (1 - headH) * 0.42;
  }
  ovalY = Math.min(1 - headH, Math.max(0, ovalY));
  return {
    oval: { x: ovalX, y: ovalY, width: ovalW, height: headH },
    eyeY,
  };
}
