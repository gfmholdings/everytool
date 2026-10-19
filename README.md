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
| Long screenshot | Stitch a screen recording's frames (primary) or picked overlapping photos (secondary). Always normalized to ≤1170px wide, output height capped at 8192px; seams with no overlap are reported, never silently stacked. |
| Clipboard | Local clipboard vault: save, pin, tap to copy. Shared with the keyboard via the App Group. |
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
  keyboard (symbols page, shift, delete-repeat, globe key) that types with
  Full Access OFF. Tabs inside: Clipboard (the shared vault, tap to insert
  via `textDocumentProxy`) and Text tools (counts + extraction over the text
  around the cursor; line transforms capped at 1500 chars). Open Access is
  requested for the pasteboard + App Group only; there is no network code.
- **controls** (`.widget`, WidgetKit) — three iOS 18 Control Center controls
  (Stitch / Convert / QR). Each runs `OpenToolIntent`, which records the tool
  in the App Group; the app consumes it on activation (`takePendingTool`).
  A control is a door, not the tool — stated in the code.
- **share** (`.share`) — SwiftUI share sheet for images (≤20), PDFs and text,
  routed to stitch / convert / resize / PDF tools / clipboard. Files are
  copied into the App Group `ShareInbox/` with an `index.json`; the app
  drains it on launch and routes by the first item's tool.
- **broadcast** (`.broadcast`) — `SampleHandler.swift`: ReplayKit upload
  extension. Samples ~1 frame/sec, scales to ≤1170px wide, writes PNG frames
  to the App Group `BroadcastInbox/`; flags `finished` when the broadcast
  ends. The app stitches the frames on next launch.
- **broadcastui** (`.broadcastui`) — the setup screen shown in Apple's
  broadcast picker; instructions only. Starting/stopping is always Apple's
  own recording UI.
- **_shared/SharedVault.swift** — the App Group contract every target
  compiles: state JSON in the `group.app.everytool.ios` UserDefaults suite
  (key `everytool.state.v1`), plus both inboxes. The app reaches the same
  store through the local Expo module in `modules/shared-vault/`
  (with an AsyncStorage fallback when the module is absent, e.g. Expo Go).

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
src/lib/stitchMath.ts    Stitch plan: width normalization, height cap
src/lib/deflate.ts       Pure DEFLATE decoder + streaming stored-block
                         PNG writer (no native codec dependency)
src/lib/stitch.ts        Streaming stitcher (row-at-a-time, FileHandle)
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

## Verification (all run, all green)

- `npx tsc --noEmit` — clean
- `npx eslint .` — clean
- `npm test` — 30/30 (days incl. month-end clamping, split-bill exact cents,
  text extraction dedupe, stitch caps, page specs, QR payloads, PNG
  roundtrip via the app's own writer/decoder, GIF LZW roundtrip)
- `npx expo export --platform ios` — succeeds
- `npx expo prebuild -p ios` in a scratch copy — generates all five extension
  targets (EverytoolKeyboard, EverytoolControls, EverytoolShare,
  EverytoolBroadcast, EverytoolBroadcastUI) with bundle IDs
  `app.everytool.ios.*`, the App Group entitlement on app + keyboard +
  share + controls + broadcast, the hand-written keyboard/share Info.plists
  preserved (`RequestsOpenAccess`, activation rule), and `SharedVault.swift`
  referenced by every target. Scratch deleted afterwards.

The test suite caught one real bug during the build: `PngStreamWriter`
folded the zlib header into the first stored block's payload, making its
own PNGs undecodable. Fixed; the roundtrip tests pin it.

## Honest limits and stubs

- **Broadcast stitching fidelity is approximate.** Sample buffers carry no
  scroll metadata; the app estimates each seam's overlap by matching frame
  content in a bounded strip search. Slow, steady scrolling stitches well;
  fast jumps produce a seam the UI reports ("stacked — no overlap found")
  instead of hiding it. Sampling is ~1 fps by design (1170px-wide PNGs).
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
