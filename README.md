# Everytool

The missing tools belt: ten everyday tools iOS lacks, composed across the
surfaces Apple allows — the app, a real typing keyboard, Control Center
controls, the share sheet, and a ReplayKit broadcast — fully on-device.
No backend, no accounts, no network calls, nothing transmitted.

Expo SDK 57 / React Native 0.86 / TypeScript. Bundle ID `app.everytool.ios`,
team `8H56KM6SCW`, scheme `everytool`.

## The ten tools

| Tool | What it does |
| --- | --- |
| Long screenshot | **Screenshots mode:** tap Start (or the Start Long Screenshot control), take ordinary screenshots while scrolling in any app, tap Stitch — every screenshot since Start becomes one image (sources can be deleted after). **Record mode:** tap Record, scroll, stop — stitched automatically. Also from picked overlapping screenshots. ≤1170px wide, **no height limit** (rows stream into a compressed PNG); fixed bars appear once; seams with no overlap are reported. Save to Photos, Share, Copy. |
| Clipboard | Clipboard vault: save, paste, copy, cut, edit, pin, share, search, delete, clear. Same vault as the keyboard (App Group), edits flow both ways. |
| Convert | Image → JPG / PNG / PDF; several photos → one PDF. |
| QR toolbox | Make QR codes (text, Wi-Fi, contact), scan from camera or from a photo, made/scanned history. |
| Resize photo | Target width + quality, before/after byte sizes. |
| PDF tools | Merge (reorderable), extract page ranges, compress (object-stream re-save; stated honestly in the UI). |
| Text tools | Word/character/line counts; extract links, emails, phone numbers; remove duplicate lines; sort lines. |
| Days counter | Days between dates, days until, age in days. Calendar math clamps month-ends (Jan 31 → Mar 1 = 1 month 1 day). |
| Split bill | Total, tax, tip presets/custom, N people. Integer-cent math; shares always sum exactly to the total. |
| Video to GIF | First 5 seconds, 8 fps, 360px wide, fixed palette — labeled "simplified" in the UI, because it is. |

## Surfaces (native targets, via @bacons/apple-targets)

All under `targets/`; bundle IDs derive from `app.everytool.ios`.

- **keyboard** (`.keyboard`) — `KeyboardViewController.swift`: a real QWERTY
  keyboard (two symbol pages, shift + caps lock, delete-repeat, cursor keys,
  globe key) that types with Full Access OFF. Tabs inside: Clipboard — a
  full manager (Paste / Copy / Cut / Save / New / Clear on the field; per
  clip insert, copy, edit, pin, delete; edits typed with the keyboard's own
  keys) — and Text tools (counts + extraction over the text
  around the cursor; line transforms capped at 1500 chars). Open Access is
  requested for the pasteboard + App Group only; there is no network code.
- **controls** (`.widget`, WidgetKit) — thirteen iOS 18 Control Center
  controls: one per tool, Record Long Screenshot, Start Long Screenshot
  (records a session start without leaving the current app —
  `SessionIntents.swift`) and Stitch Screenshots. Each runs
  `OpenToolIntent` (compiled into the extension AND the app target via
  `plugins/withOpenToolIntent.js`), which records the tool in the App Group;
  the app consumes it on activation (`takePendingTool`).
- **share** (`.share`) — SwiftUI share sheet for images (≤20), PDFs and text,
  routed to stitch / convert / resize / PDF tools / clipboard. Files are
  copied into the App Group `ShareInbox/` with an `index.json`; the app
  drains it on launch and routes by the first item's tool.
- **broadcast** (`.broadcast`) — `SampleHandler.swift`: ReplayKit upload
  extension. Samples every 0.4 s, skips unchanged frames, scales to ≤1170px
  wide, writes PNG frames to the App Group `BroadcastInbox/`; flags
  `finished` and posts a "ready" notification when the broadcast ends. The
  app opens the stitcher and stitches automatically.
- **broadcastui** (`.broadcastui`) — the setup screen shown in Apple's
  broadcast picker; instructions only. Starting/stopping is always Apple's
  own recording UI.
- **_shared/SharedVault.swift** — the App Group contract every target
  compiles: state JSON in the `group.app.everytool.ios` UserDefaults suite
  (key `everytool.state.v1`), plus both inboxes. The app reaches the same
  store through the local Expo module in `modules/shared-vault/`
  (with an AsyncStorage fallback when the module is absent, e.g. Expo Go).
  The module is linked through `modules/shared-vault/ios/EverytoolSharedVault.podspec`
  — without a podspec autolinking skips it silently.

## Code map

```
App.tsx                  Home grid (ten plain-name tiles) + tool routing,
                         deep links everytool://tool/<id>, inbox draining
src/theme.ts             One accent system (blue #007AFF, orange #F5861F),
                         one bold-sans numeral style
src/types.ts             ToolId ×10, Clip, QrHistoryItem, AppState
src/config.ts            App Group id, scheme
src/lib/dates.ts         Calendar math (clamped month advancement)
src/lib/money.ts         Integer-cent bill splitting
src/lib/text.ts          Counts, extraction (deduped), line cleanup
src/lib/pages.ts         PDF page-range parsing ("1-3,5")
src/lib/stitchMath.ts    Width normalization (no height cap)
src/lib/stitchCore.ts    Stitch engine: header/footer, duplicates, seams, segments
src/lib/clips.ts         Clipboard vault operations (pure, tested)
src/lib/deflate.ts       Pure DEFLATE decoder + streaming stored-block
                         PNG writer (no native codec dependency)
src/lib/stitch.ts        On-device stitch: native downscale for matching, streamed PNG out
src/lib/qrpayload.ts     Wi-Fi / vCard QR payload builders
src/lib/pdf.ts           pdf-lib merge / extract / compress
src/lib/gifenc.ts        Pure GIF89a encoder (fixed palette, LZW)
src/lib/gif.ts           Video → GIF sampling via expo-video-thumbnails
src/lib/files.ts         Temp files, sizes, sharing
src/lib/incoming.ts      Share / broadcast inbox draining
src/store/               AppStore (React context) + shared-vault bridge
src/screens/             One screen per tool
src/components/ui.tsx    ToolShell, cards, buttons, segmented, glyphs
tests/                   Node smoke tests for the pure logic
```

## Verification

- `npx tsc --noEmit`, `npx eslint .`, `npm test` (48 tests, incl. pixel-exact
  stitch tests) — see AUDIT.md.
- iPhone simulator: `.github/workflows/ios-simulator-tests.yml` builds for the
  simulator, boots an iPhone, installs, and runs the Maestro suite in
  `.maestro/` via `scripts/sim/run-e2e.sh`. Locally on a Mac:
  ```
  npx expo prebuild -p ios --clean
  xcodebuild -workspace ios/Everytool.xcworkspace -scheme Everytool \
    -configuration Release -sdk iphonesimulator -derivedDataPath build/sim \
    CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= build
  xcrun simctl install booted build/sim/Build/Products/Release-iphonesimulator/Everytool.app
  node --experimental-strip-types scripts/sim/make-fixtures.ts sim-fixtures
  UDID=$(xcrun simctl list devices booted -j | python3 -c 'import json,sys;print([d["udid"] for r in json.load(sys.stdin)["devices"].values() for d in r][0])') \
    FX=sim-fixtures scripts/sim/run-e2e.sh
  ```

## Honest limits and stubs

- **Stitching needs overlap.** Sample buffers carry no scroll metadata; the
  app matches frame content at full row precision. Frames are sampled every
  0.4 s, so normal scrolling overlaps; a fling that moves more than a
  screen between samples produces a seam the UI reports ("stacked")
  instead of hiding it. Very long images (tens of thousands of px) are
  fine to Share/Save to Files; Photos may display them downscaled.
- **PDF "compress"** is an object-stream re-save via pdf-lib. It shrinks
  PDFs with uncompressed or redundant structure; it does NOT re-encode
  embedded images, and the UI says "may not shrink image-heavy PDFs".
- **Keyboard text transforms** can only see and rewrite the text around the
  cursor that iOS exposes to keyboards (`documentContextBeforeInput`),
  capped at 1500 characters. Full-document editing lives in the app.
- **GIF** is deliberately simplified: first 5 seconds, 8 fps, 360px wide,
  one fixed 216-colour palette, no dithering. Labelled as such in the UI.
- **QR scan from photo** uses `expo-camera`'s `scanFromURLAsync` (QR only).
- **EAS is not initialized** — `app.json` carries
  `REPLACE_WITH_EVERYTOOL_EAS_PROJECT_ID` placeholders on purpose. No store
  steps have been taken.
- Extensions exist only in native (prebuild/EAS) builds, never in Expo Go;
  in Expo Go the app still runs with the AsyncStorage fallback store.
