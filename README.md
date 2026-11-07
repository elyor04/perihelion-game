# Perihelion

A one-touch gravity puzzle for desktop and mobile, built with **Wails v3**, **Go**, **React** and **TypeScript**.

Pull back to aim, let go, and the comet flies through a field of worlds. Planets bend its path, black holes swallow it, repulsors push it away, moons move the moment you launch, belts shatter it and wormholes fold the chart in two. Reach the gate in as few launches as you can.

## Features

- **30 handcrafted levels in three sectors.** Each sector introduces new ideas. The Shallows teaches gravity and asteroid belts. The Undertow adds moving moons and black holes. The Fold adds wormholes and repulsors. Every level is checked by a Go test that sweeps 720 angles × 51 powers with the game's own integrator and requires robust solutions.
- **Stars per level.** Reach the gate within par for three stars, within par + 2 for two, and any clear earns one. Levels unlock in order, and you may skip one stubborn level. A sector opens once 7 of the previous sector's 10 levels are cleared.
- **Daily orbit.** Go generates a chart from the UTC date and proves it can be solved before serving it. Candidates are flown through the same angle × power sweep, and a candidate is accepted only if it has launches whose neighbouring launches also succeed. It also has to be neither trivial nor brutal. Everyone gets the same chart, best results and a day streak are saved, and the day rolls over at 00:00 UTC.
- **One deterministic flight model in two languages.** It is a semi-implicit Euler integrator with a fixed 1/120 s step, using only `+ − × ÷ √`. The Go version wraps every product in `float64()` so arm64 can't fuse it into an FMA. `npm run check:physics` replays 185 recorded Go flights in TypeScript and checks that they match bit for bit.
- **Aim guide for the first quarter of the path only** (half with the "Longer aim guide" setting). The full trail of your last launch stays on the chart as a dashed ghost, so you can correct on the next try.
- **The look: a cyanotype star chart.** The chart is drawn in Prussian blue and chalk, with hatched planets and isolines. The graticule and the starfield bend around every mass (gravitational lensing), and black holes show an event horizon and a photon ring. The amber comet has a particle tail and an orbit trail, and time slows on near misses.
- **Procedural audio.** WebAudio synthesises every sound: drone, bells, launch, flight hum, impacts and the gate chord. No audio files ship with the game.
- **Haptics and keep-awake on mobile** through `application.Mobile`. Screen shake and reduced motion are settings, and the default follows the OS.
- **Three languages.** The game ships in English, Russian and Uzbek (Latin script, with proper ʻ U+02BB and ʼ U+02BC). It follows the device language on first launch. You can switch with EN/RU/UZ on the title screen or in Settings, and the choice is saved in the Go profile.

## Controls

| Action | Mouse / touch | Keyboard | Gamepad |
|---|---|---|---|
| Aim and set power | Drag back from anywhere | ← → (or A/D) aim, ↑ ↓ (or W/S) power; hold Shift for fine steps | Left stick aims; RT/LT or right stick for power; d-pad nudges |
| Launch | Release the drag | Space / Enter | A |
| Call the comet back | Tap / click | Space / Enter | A |
| Restart level | Restart button | R | Y |
| Pause / back | Pause button, Android Back | Esc | B / Start |
| Menus | Tap | Tab or arrow keys, Enter | D-pad / stick, A, B |
| Fullscreen (desktop) | Settings | F11 | |

Keys are matched by physical position (`KeyboardEvent.code`), so they also work on Russian and other layouts. Esc, gamepad B and Android Back all go through one `back()` function. Back leaves the app only from the title screen.

## Project layout

```
main.go                              Wails app and window
internal/game/physics.go             Deterministic flight model (mirrored in frontend/src/game/physics.ts)
internal/game/level.go               Level types and builders
internal/game/catalog.go             The 30 levels in three sectors
internal/game/solver.go              Angle x power survey used to verify levels
internal/game/daily.go               Seeded daily generator + verification
internal/game/profile.go             Profile model and atomic JSON store
internal/game/gameservice.go         Bound service: profile, catalog, results, daily, haptics, keep-awake
internal/game/export.go              Data for the browser preview and the physics cross-check
internal/tools/export                go run ./internal/tools/export: regenerate those data files
internal/tools/levelviz              go run ./internal/tools/levelviz OUT [ids]: render levels + solutions to PNG
frontend/src/game                    Canvas engine, physics port, renderer, input, audio
frontend/src/ui                      React screens: title, level select, HUD, dialogs
frontend/src/api                     Typed adapter over the bindings (+ browser preview backend)
frontend/src/i18n                    en.ts (reference), ru.ts, uz.ts and helpers
frontend/scripts/check-physics.ts    Go/TypeScript bit-for-bit flight comparison
```

Results are validated in Go. A submitted result must name an existing level that is unlocked, with 1–999 shots and exactly the stars those shots earn against par. Daily results are accepted only for today's or yesterday's UTC date. Go errors carry a stable `code` (`GameError`), and the UI translates it as `error.<code>`.

Saves are written atomically: a mutex, copy-on-read, rollback on any failure, then a temp file, fsync and rename. An unreadable profile is kept as `profile.json.corrupt-<UTC timestamp>`. Saves live in `%APPDATA%\Perihelion` on Windows, `~/Library/Application Support/Perihelion` on macOS and `~/.config/Perihelion` on Linux. On phones they go to the app's private storage.

## Languages

All display text lives in `frontend/src/i18n/`. `en.ts` is the reference, and `ru.ts` and `uz.ts` are typed as `Dict`, so a missing or extra key fails `tsc`. Counts use `Intl.PluralRules`, and numbers are formatted for the locale (`1,5` in Russian and Uzbek). The engine and Go send IDs only.

Headings use Cormorant and text uses Commissioner. Both are variable fonts that cover Cyrillic and draw ʻ/ʼ correctly.

## Develop

```bash
wails3 dev                                   # desktop app with hot reload
go test ./...                                # backend tests (catalog solvability, daily determinism, store, validation)
cd frontend && npx vite --port 9246          # browser-only preview (progress kept in localStorage)
cd frontend && npx tsc --noEmit              # typecheck; missing translations fail here
cd frontend && npm run check:physics         # Go vs TypeScript integrator, bit for bit
go run ./internal/tools/export               # after changing levels or physics: refresh preview + golden data
```

The browser preview is chosen only when there's no Wails runtime (no WebView2/WKWebView/Android bridge). Inside the app, a failing Go call shows an error with Retry instead of switching to the preview. The preview uses the Go-generated catalog and one sample daily chart.

In dev builds, `window.__game.debugAim(degrees, power)` sets the aim exactly. The browser tests use it.

## Build

```bash
wails3 build                       # bin/perihelion.exe (or the macOS/Linux binary)
wails3 task android:package:fat    # arm64 + x86_64 APK (runs on emulators)
wails3 task android:package        # arm64-only release APK
wails3 task android:bundle         # .aab for Google Play
```

`build/android/Taskfile.yml` is patched so these tasks run on a Windows host: NDK path normalisation, the Windows clang target, `gradlew.bat`, and forwarding `PRODUCTION` to the Go build. The Android activity routes system Back to the game through `OnBackPressedDispatcher`, because Android 16 no longer calls `onBackPressed()` for apps targeting SDK 36. Libraries for other ABIs stay in `build/android/app/src/main/jniLibs/` between builds. Delete `jniLibs/x86_64` before `android:package` so the arm64 APK doesn't pick up a stale x86_64 `.so`. `android:run` and `android:deploy-device` default `ARCH` to the host (amd64 on Windows), so pass `ARCH=arm64` for a real phone.

Each device generates the daily orbit itself. The generator avoids FMA, but `math.Cos`/`math.Sin` may differ by one ulp between amd64 and arm64, so on rare days a phone and a desktop could get slightly different charts.

**Signing:** release APKs are signed with the Android debug key unless `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` are set. That's fine for sideloading, but Google Play rejects it. The application id is `com.perihelion.game`.

### macOS and iOS

These need a Mac with Xcode.

```bash
wails3 task darwin:package             # bin/perihelion.app, arm64, ad-hoc signed
wails3 task darwin:package:universal   # same, arm64 + amd64
wails3 task darwin:package:dmg         # bin/perihelion.dmg installer
wails3 task ios:package                # bin/perihelion.app for the iOS Simulator (iOS 15+)
wails3 task ios:deploy-simulator       # package, install and launch on the booted simulator
```

Both packages are written to `bin/perihelion.app`, so move one aside before building the other platform.

The macOS icons (`build/darwin/icons.icns` and `Assets.car`) are compiled from `build/appicon.icon`. Its only layer is a full-bleed copy of `build/appicon.png`, the same artwork as the Windows and Android icons. After changing `appicon.png`, refresh that layer, then rebuild the icons. The icon task also rewrites `build/windows/icon.ico`.

```bash
magick \( build/appicon.png -resize 135% -gravity center -extent 1024x1024 -blur 0x24 -background black -alpha remove \) \
  build/appicon.png -gravity center -composite -alpha off build/appicon.icon/Assets/appicon.png
wails3 task common:generate:icons
```

`build/ios/xcode/` is regenerated from `build/config.yml` and `build/appicon.png` on every iOS build and isn't committed.

A real iPhone needs real signing and a provisioning profile: `wails3 task ios:package:ipa IOS_PLATFORM=device CODESIGN_IDENTITY="Apple Development: …" PROVISIONING_PROFILE=path/to/profile.mobileprovision`, or `wails3 task ios:xcode` to let Xcode manage signing.
