# Everytool regression audit (Oct 2026)

Scope: every tool and every iOS surface (app, keyboard, Control Center
controls, share extension, broadcast extension). Each finding below is
fixed in this tree.

## Critical: cross-surface features were dead in native builds

| # | Finding | Effect | Fix |
|---|---|---|---|
| C1 | `modules/shared-vault` had **no podspec**. `expo-modules-autolinking` returns `null` for a module without one, so the module was never linked. | `requireOptionalNativeModule('EverytoolSharedVault')` was `null` in every build. The app silently fell back to private AsyncStorage: **clips never reached the keyboard**, Control Center taps were never routed, and **shared files and screen recordings were never picked up** (no App Group path). | Added `modules/shared-vault/ios/EverytoolSharedVault.podspec`; CI asserts it appears in `Podfile.lock`. On first launch, clips that are only in AsyncStorage are migrated into the App Group. |
| C2 | `MediaLibrary.saveToLibraryAsync` (root export) **throws at runtime** in Expo SDK 57. | Every **Save to Photos** button was broken: Long screenshot, Convert, Resize, GIF. | One `saveToPhotos()` helper using `expo-media-library/legacy` with add-only permission. It shows a message if saving fails. |
| C3 | The Control Center intent existed only inside the CocoaPods module. App Intents metadata is not extracted from pods. | iOS could not find the `openAppWhenRun` intent in the app, so the controls were unreliable. | `targets/controls/OpenToolIntent.swift` is compiled into the controls extension **and** copied into the app target by `plugins/withOpenToolIntent.js` (verified in the generated `project.pbxproj`). |

## Requested features

**Control Center: every tool can be added.** There are 11 controls: Record Long Screenshot, plus one for each of the 10 tools. Each opens the app at that tool. "Record Long Screenshot" opens the stitcher and immediately raises Apple's broadcast sheet with Everytool preselected. The existing control kinds (`stitch`, `convert`, `qr`) are unchanged, so controls users already placed keep working.

**Keyboard clipboard manager** (`targets/keyboard`):
- **Paste** inserts the system clipboard.
- **Copy** and **Cut** act on the text the user selected in the field. Both also save to the vault.
- **Save** stores the selection, or the clipboard if nothing is selected.
- **New** types a new clip with the keyboard's own keys (an in-keyboard editor).
- **Clear** removes unpinned clips after a confirmation tap.
- **Per clip:** tap to insert; buttons to copy ⧉, edit ✎, pin ★ and delete ✕.
- The current system clipboard is shown at the top with one-tap save.
- Typing also gained: a second symbols page (`#+=`), caps lock (double-tap shift), cursor ◀ ▶ keys, and the globe key only when iOS asks for it.
- Writes are read-modify-write on the shared document, so they never drop QR history or the app's changes.
- Full Access is required for the pasteboard and the App Group. iOS allows nothing else; the tab says so.

**App clipboard:**
- Per clip: Copy, Edit, Pin, Share, Cut (copy + remove), Delete.
- Paste into the draft, search, and "Clear unpinned" with a confirmation.
- Saving text that already exists moves it to the top instead of duplicating it.
- The app re-reads the vault on foreground and every 1.5 s while the screen is open, and every write re-reads first. Edits made in the keyboard therefore show up and are never overwritten.

**Long screenshot: native capture, unlimited length, save and share:**
- **Record button in the app** (`RPSystemBroadcastPickerView`, Everytool preselected), plus the new control.
- The broadcast extension samples every 0.4 s, **skips unchanged frames** (a 24×52 signature), and posts a "Long screenshot ready" notification when the recording stops.
- When the app opens, a finished recording **opens the stitcher and stitches automatically**.
- **No height cap.** The old 8192 px cap and down-scaling are gone. Rows stream from each frame into a **compressed** PNG on disk (fflate zlib, RGB, Up filter), one frame in memory at a time.
- New matching engine (`src/lib/stitchCore.ts`):
  - Detects the fixed header and footer (status bar, nav bar, tab bar, home indicator), so each appears once.
  - Ignores the changing clock or recording pill and the moving scroll indicator.
  - Matches seams at full-row precision; the old matcher used 96 px thumbnails, about ±12 px per seam.
  - Drops paused frames, and trims Control Center and alert frames at the start and end.
  - Reports seams it could not match instead of hiding them.
- **Preview:** a card, plus a full-length scrollable viewer that draws the used rows of each frame, so a giant bitmap is never decoded.
- **Save to Photos, Share** (Messages, AirDrop, Save to Files…) and **Copy image** (up to 12,000 px tall).
- "From photos": unlimited, ordered selection, with reordering.

## Other regressions fixed

- Items shared while the app was **already running** were never processed; the inbox was drained only at launch. The inbox is now drained on every deep link and every time the app comes to the foreground.
- Shared images arrived as **0×0**. As a result:
  - Resize had every width disabled and output an unresized image.
  - Stitch computed a width of 0.
  - Convert showed "0 × 0".
  
  All three now measure the file.
- Resize called `setState` during render for shared photos. Moved into an effect.
- Shared text was read with `fetch(file://)`. It now uses `File.text()`, saves every shared text item, and opens Clipboard.
- The QR tool could make codes but not export them. Added **Share**, **Save to Photos** and **Copy text**. The Wi-Fi password field is now masked, and the phone and email fields use the right keyboards.
- The share sheet did not appear for Safari page shares. Added `NSExtensionActivationSupportsWebURLWithMaxCount`.
- `app.json` listed every app extension twice. Deduplicated.
- The PNG decoder copied IDAT one byte at a time into a JS array and inflated with a bit-by-bit decoder. It now uses fflate and typed arrays, far faster on device.

## Verification

Run here (Linux):
- `npx tsc --noEmit`: clean.
- `npx eslint .`: clean.
- `npm test`: 48/48. New tests cover:
  - Clip operations.
  - The stitch engine on a synthetic phone screen with a changing clock, nav and tab bars, a moving scroll indicator, duplicate frames, Control Center frames and capture noise. The output is checked **pixel for pixel**.
  - The PNG writer decoded back.
- `npx expo prebuild -p ios`: confirmed that:
  - All 6 targets are generated with bundle IDs `app.everytool.ios[.keyboard|.widget|.share|.broadcast|.broadcastui]`.
  - The App Group is on the app and 4 extensions.
  - `OpenToolIntent.swift` is in the app target's Sources.
  - The controls target is at iOS 18.0.
- The fixture "recording" (8 frames at 1170×2532, one paused) stitches to exactly 1170×6732, with the bars once and no stacked seams.

Needs a Mac (Xcode is not available on Linux): `.github/workflows/ios-simulator-tests.yml` does the following.
- Builds for the iPhone simulator.
- Checks that the 5 extensions and the controls are present in the bundle.
- Boots an iPhone, installs the app, and runs `scripts/sim/run-e2e.sh`. Its Maestro flows cover:
  - All ten tools, and every control route.
  - The full clipboard cycle, and **asserts the clip is in the App Group plist** (what the keyboard reads).
  - Convert, Resize, PDF and Stitch fed through the real share inbox.
  - A recording fed through the real broadcast inbox, which auto-opens, stitches, and saves to Photos.
  - The keyboard's Clipboard tab. This step drives iOS Settings and is non-blocking.

Not automatable on a simulator:
- ReplayKit broadcasting itself.
- Adding controls in Control Center.
- Camera QR scanning.
- The GIF video picker.

These paths are covered up to the boundary (inbox, routes, decode) and need one manual pass on a device.

## Added after the audit: screenshot sessions

iOS doesn't let a third-party app capture other apps' screens, float a
"hold" control over them, or follow the user's swipes. So the Android-style
"hold the first screenshot and drag to the next page" can't exist on iPhone.
The closest equivalent is now the default mode of Long screenshot:

- **Start:** tap Start in the app, or the **Start Long Screenshot** control,
  which records the start time without leaving the current app.
- **Capture:** take normal screenshots while scrolling. Back Tap → Screenshot
  makes this a tap on the back of the phone.
- **Stitch:** tap Stitch in the app, or the **Stitch Screenshots** control,
  which opens the app and stitches straight away.
- **Which screenshots:** Everytool finds every screenshot taken since Start
  through PhotoKit (subtype `screenshot`, portrait, the dominant screen
  size, in the order taken). It stitches them with the same engine, with
  no length limit. Save, Share and Copy work as before, plus **Delete the N
  screenshots from Photos**, which iOS confirms.
- **Photos access:** needs Full Access, because new screenshots are hidden
  from "Limited" access. The screen explains this and links to Settings.
- **Tests:** `src/lib/sessionPick.ts` is unit-tested in `tests/session.test.ts`.
  Simulator flows `12a`/`12b` add tagged screenshots between Start and Stitch.

## PDF pass (tests + compress fix)

PDF logic now lives in `src/lib/pdfCore.ts`, which works on bytes only and
has no file system code; `src/lib/pdf.ts` only does the file I/O. Tested in
`tests/pdf.test.ts` against real PDFs built by pdf-lib.

- **Merge:** PDFs and photos stay in list order, with one page per photo,
  sized to that photo. PNG photos now work too (before: JPEG only). Empty
  lists and non-images are rejected with a message.
- **Split:** the requested pages come out in the order asked;
  out-of-range pages are ignored.
- **Compress:** measured on three kinds of PDF.

  | PDF kind | Original compress | Now |
  |---|---|---|
  | Structure-heavy | about 50% smaller | unchanged |
  | Photo-heavy | 0.4% smaller (the UI already says so) | unchanged |
  | Carrying leftover, unused objects from earlier edits | 0.7% smaller | 80%+ smaller |

  - **Bug fixed:** the leftover objects were kept. Compress now drops them,
    but only when the PDF has no bookmarks, form fields or named links. If
    it has any of those, it does a plain re-save, so they survive (tested
    with a filled form field).
  - **Bug fixed:** compress could return a file *bigger* than the original.
    It now never does; the screen says "Already as small as Everytool can
    make it" instead.
