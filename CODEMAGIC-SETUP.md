# Codemagic setup — Everytool

Account-side checklist for running `codemagic.yaml` (in the repo root of
`gfmholdings/everytool`). The yaml defines two workflows, both
**manual-trigger only** (no `triggering:` section — nothing ever builds
on push):

- `simulator-regression` — unit gates + simulator build + Maestro suite
  (port of `.github/workflows/ios-simulator-tests.yml`)
- `testflight` — manual signing, archive, .ipa verify, TestFlight upload
  (port of `.github/workflows/ios-testflight.yml`)

The GitHub workflows stay in place, untouched, as the reference original.

## 1. Add the app

1. Codemagic → **Add application** → connect the GitHub repo
   `gfmholdings/everytool` (the owner already connected GitHub).
2. When asked for the build configuration, choose **codemagic.yaml**
   (it is committed at the repo root). Codemagic picks up both
   workflows from it.
3. Instance type in the yaml is `mac_mini_m2`. If the free plan will not
   schedule that type, edit `instance_type` in `codemagic.yaml` to the
   strongest the plan offers and re-commit — nothing else changes
   (`max_build_duration` is already generous: 120 / 90 minutes).

## 2. Create the `signing` environment variable group

Codemagic → (team/app) **Environment variable groups** → create a group
named exactly **`signing`**, and add the 11 variables below, each marked
**secure/encrypted**. The `testflight` workflow references the group by
name; no secret value is ever stored in the repo.

Every value already exists locally under `~/workspace/everytool/credentials/`
(gitignored, never committed). Base64 values are single-line:
`base64 -i <file> | tr -d '\n'` produces exactly what to paste.

| Variable | Value | Source |
|---|---|---|
| `CERT_P12_BASE64` | base64 of the distribution cert .p12 | `credentials/dist.p12` |
| `CERT_P12_PASSWORD` | the .p12 password (plain text, 32 chars) | contents of `credentials/p12-password.txt` |
| `PROFILE_APP_B64` | base64 of the app profile | `credentials/portal/profile-app.mobileprovision` |
| `PROFILE_KEYBOARD_B64` | base64 of the keyboard profile | `credentials/portal/profile-keyboard.mobileprovision` |
| `PROFILE_SHARE_B64` | base64 of the share profile | `credentials/portal/profile-share.mobileprovision` |
| `PROFILE_WIDGET_B64` | base64 of the widget/controls profile | `credentials/portal/profile-widget.mobileprovision` |
| `PROFILE_BROADCAST_B64` | base64 of the broadcast profile | `credentials/portal/profile-broadcast.mobileprovision` |
| `PROFILE_BROADCASTUI_B64` | base64 of the broadcast-UI profile | `credentials/portal/profile-broadcastui.mobileprovision` |
| `ASC_API_KEY_B64` | base64 of the App Store Connect API key | `credentials/AuthKey_F2LNSRU725.p8` |
| `ASC_KEY_ID` | `F2LNSRU725` | (key id of the .p8 above) |
| `ASC_ISSUER_ID` | `8d934493-4d03-4569-a850-74599c85e07f` | App Store Connect issuer id |

Notes:

- The profiles are the portal-made App Store profiles (expire
  2027-10-19), the cert is "Apple Distribution: GFM Holdings LLC
  (8H56KM6SCW)" — the same package the GitHub lane used.
- If `ASC_ISSUER_ID` is left out of the group, the testflight build
  still succeeds and produces the .ipa as an artifact; only the upload
  is skipped (same gate as the GitHub lane).
- After pasting, sanity-check lengths before the first run: a truncated
  base64 paste fails the signing step with a decode/import error, not
  silently.

### Alternative: Codemagic's own integrations

Codemagic offers an **App Store Connect integration** (team settings →
integrations) using the same API key, plus built-in code-signing
identity/profile management and a `publish:` step / `app-store-connect`
CLI for TestFlight submission. That would let the manual keychain +
altool steps shrink considerably. The ported workflow deliberately does
**not** use it: it replicates the proven GitHub lane 1:1 (same keychain
script, same altool upload, same "UPLOAD SUCCEEDED" verdict) so the
first Codemagic runs are comparable to the GitHub runs. Switching to
the native integration is a later, separate change — don't mix it into
the first runs.

## 3. Watch items on the first runs

- **Xcode pin.** `codemagic.yaml` pins `xcode: 16.4`. The GitHub lane
  hit a real failure here: Expo's prebuilt-RN Swift packages declare
  swift-tools 6.2 and error under Swift 6.1 ("package 'apple' is using
  Swift tools version 6.2.0 but the installed version is 6.1.0"), which
  GitHub solved by selecting the **newest** Xcode on the image. If the
  Prebuild step fails with that exact message, change the pin in both
  workflows to `xcode: latest` and re-run — that is the known fix, not
  a guess.
- **Build numbers.** Codemagic's `$BUILD_NUMBER` counts from 1 per app,
  but App Store Connect already holds CFBundleVersions **1** and **10**
  for Everytool 1.0.0 from the GitHub lane and rejects duplicates. The
  yaml therefore uses `EFFECTIVE_BUILD_NUMBER = BUILD_NUMBER + 1000`
  for patch-signing, the archive override and the .ipa verify step, so
  every Codemagic upload lands at 1001+. Keep the offset.
- **Cross-step variables.** The yaml passes `UDID`, `APP`,
  `EFFECTIVE_BUILD_NUMBER` and `IPA_PATH` between steps by appending
  to `$CM_ENV` (Codemagic's mechanism). If a later step ever shows one
  of them empty on the first run, that mechanism is the first thing to
  check.
- **Maestro/Java.** The Install Maestro step asserts a Java runtime
  (`java -version || brew install openjdk@17`) before the curl install,
  mirroring what the GitHub image provided implicitly.

## 4. Run order for the first builds

1. **`simulator-regression`** on `main` (commit eb4cf16 or newer).
   This is the run that settles the three flow fixes committed in
   eb4cf16 (03 clipboard keyboard dismissal, 08 resize scrolls,
   11 stitch toolbar assertion). Expect green on everything blocking;
   flows 14 (receipt scan), 12b (session finish) and 20 (keyboard) are
   non-blocking by design — `scripts/sim/run-e2e.sh` owns that map.
   12a (session start) should pass: the strict Photos grant with TCC
   `auth_value` readback is in the workflow.
2. **Only if the blocking set is fully green:** run **`testflight`**
   on the **same commit**.
3. Verify the upload outside Codemagic: the build must appear under
   App Store Connect app **6824418913** (Everytool) and move to
   processing/VALID. The workflow itself already fails unless altool
   prints `UPLOAD SUCCEEDED` and the .ipa verify step has passed.

Start builds from the Codemagic UI (app → workflow → Start new build)
or the Codemagic API. Nothing starts automatically.
