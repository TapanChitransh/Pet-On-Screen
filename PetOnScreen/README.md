# PetOnScreen 🐾

A virtual pet that lives on top of your screen while you work. It walks around, sits, naps,
looks at your cursor, gets the zoomies, brings you gifts and occasionally asks you to take a break.
You keep using your computer normally; the pet lives in a transparent click-through overlay.

Built with **Electron + React + TypeScript**. The behavior engine is pure TypeScript with no UI or
Electron dependencies, so it is unit-tested on its own.

## Run it

```bash
npm install
npm run dev        # hot-reloading dev build
npm run build      # production bundle into out/
npm start          # run the production bundle
npm test           # engine unit tests (vitest)
npm run typecheck
npm run dist       # installer via electron-builder (needs network for its tooling)
```

> Launching from an editor's integrated terminal? Some editors export `ELECTRON_RUN_AS_NODE=1`,
> which makes Electron start as plain Node and crash with `Cannot read properties of undefined
> (reading 'requestSingleInstanceLock')`. Unset it first: `env -u ELECTRON_RUN_AS_NODE npm start`.

First launch adopts a Golden Retriever named **Max** and shows him at the bottom of your primary
display. Right-click him for the menu, drag him around, click him to see how he reacts. The tray icon
(paw print) has size / monitor / pause / click-through / always-on-top controls and opens the dashboard.

## What is implemented

| Phase | Status | Highlights |
| --- | --- | --- |
| 1 Desktop pet | ✅ | Transparent frameless always-on-top overlay covering the work area; mouse passes through everywhere except over the pet; drag & drop with gravity; remembered position; multi-monitor choice; size; hide/pause; click reactions that vary |
| 2 Behavior engine | ✅ | Weighted, cooldown-aware state machine with 28 states; personality (8 traits) biases weights and drifts slowly with treatment; stats with gentle drift, self-feeding when hungry, offline catch-up; 14 rare spontaneous events; idle / return / 90-minute break awareness |
| 3 Pet system | ✅ | 24 characters: Dog (Golden Retriever), Husky, Corgi, Dalmatian, Pug, Dachshund, Shiba Inu, Border Collie, Cat, Rabbit, Fox, Wolf, Lion, Panda, Red Panda, Deer, Owl, Swan, Duck, Penguin, Unicorn, Dragon, Hamster and a tiny person Companion, each with its own silhouette (three body archetypes), gait, voice, favorites and behavior biases; multiple owned pets, switching, renaming, releasing; inventory (food, toys, treasures the pet finds); XP & levels; atomic JSON persistence |
| 3b Mini-games | ✅ | **Fetch**: pick up the ball, flick it anywhere on screen; the pet reacts with a personality-based delay, chases, leaps for balls overhead, catches, carries it back to your cursor and drops it. Lazy pets sometimes refuse, mischievous ones run off with it. **Tug of war**: hold the rope end and pull; the pet tugs back in bursts, skids when you pull, and both grips drain until someone wins the round. Score and grip meters in a small HUD, Esc or Done to stop. |
| 4 Conversation & memory | ✅ | Talk bubble with local stat-aware replies (no key needed); optional Claude replies in character via `@anthropic-ai/sdk` from the main process; memory of favorites, counts, owner name, events, relationship level |
| 5 Marketplace | 🗓️ planned | All six starters are adoptable for free today. Purchasing, currency, rare/limited pets, accessories, skins, environments are not built. Listed on the Roadmap tab, not as fake buttons. |
| 6 Polish | ◐ partial | Synthesized sounds with master toggle & volume, tray, start-with-system (installed builds). Planned: real artwork, recorded sounds, OS notifications, onboarding, walking between monitors. |

## Architecture

```
src/
  main/          Electron main process: windows, tray, persistence, activity monitor, Claude API bridge
  preload/       contextBridge API (window.petApi) - the only IPC surface
  shared/        types shared across processes (settings, save data, commands)
  models/        Pet, Personality, PetStats, Behavior catalogue, Memory, Items, Species
  engine/        BehaviorEngine, MovementEngine, PersonalityEngine, EventEngine, InteractionEngine,
                 PetEngine (orchestrator). Pure TS, no DOM, deterministic with a seeded RNG.
  services/      PetStorage (debounced saves), AudioService (WebAudio synth), AIService (conversation)
  renderer/
    src/runtime/PetRuntime.ts   frame loop, IPC glue, hover/drag/click-through bookkeeping
    src/components/
      Pet/        PetStage (overlay), PetSprite (procedural SVG placeholder), bubbles, effects, popovers
      PetMenu/    right-click menu
      PetStats/   stat bars and popover
      Chat/       talk bubble
      Dashboard/  My Pets, Inventory, Memory, Roadmap
      Marketplace/ Adopt panel
      Settings/   settings panel
tests/           vitest specs for the engine
```

### How the overlay works

One transparent `BrowserWindow` covers the work area of the chosen display and is always on top.
It starts with `setIgnoreMouseEvents(true)`, so every click falls through to
whatever is underneath. The main process polls the cursor at 20 Hz (position only) and the renderer
also listens for pointer-enter; when the cursor is over the pet's hitbox, or a menu is open, or a drag
is in progress, the window stops ignoring the mouse. That gives a pet you can grab while the rest of
the screen stays fully usable. Pet motion is a CSS transform on a composited layer, so moving the pet
never moves an OS window.

### How the pet decides what to do

`PetEngine.tick()` runs every frame: stats drift, the current activity advances, movement updates,
and when an activity ends the engine rolls for a spontaneous event (~5%) and otherwise asks the
`BehaviorEngine` for the next behavior. Each behavior in `models/Behavior.ts` has a base weight
(IDLE 30, WALK 20, LOOK 10, SIT 10, SLEEP 8, PLAY 5, STRETCH 5, GROOM 4, JUMP 3, ...) and a
modifier that reads personality, stats, mood, cursor activity, idle time and time of day. Species add
their own multipliers (cats groom and sleep more, penguins bathe, foxes hide things). Behaviors on
cooldown get zero weight, except urgent needs (sleeping when exhausted, eating when starving).

User input never "plays an animation" directly: clicks, petting, feeding and so on go through the
`InteractionEngine`, which produces a weighted, personality-dependent reaction that interrupts the
current behavior. Repeated clicking escalates from happy to annoyed to hiding.

### Performance

Measured on a 12-core laptop with Intel Iris Xe graphics at 1920x1200 (150% scaling), using the
built-in probe (`PETONSCREEN_PERF=1 npx electron .`, numbers are percent of one core, all
processes of the pet window combined):

| Situation | CPU |
| --- | --- |
| Pet idle (breathing, tail, blinking) | ~7% |
| Pet walking / playing | ~10-20% |
| Static page, no loop (floor) | ~0% |
| Same app before optimisation | ~50% idle |

What made the difference, in order of impact:

1. **Never run a 60Hz `requestAnimationFrame` loop while idle.** On a transparent full-screen window an
   empty rAF loop alone cost ~10% of a core. The runtime schedules ticks adaptively: rAF only while
   airborne, dragged or running; a 30Hz timer while moving; an ~8Hz timer while idle. Input kicks a
   tick immediately.
2. **No continuous CSS keyframe animations.** Every compositor frame costs ~2-5ms of GPU-process CPU
   here, so always-on motion (breathe, tail, blink, ear twitch, eye tracking) is written by the runtime
   at ~8Hz, and state loops (walk cycle, bounce, etc.) use `steps()` so they update 10-25 times a second.
3. **Animate composited layers, not SVG internals.** Every moving part is its own `<div>` with a
   transform. Animating groups inside one SVG re-painted the whole sprite every frame (~35% of a core).
4. **Scope style writes.** Changing an inherited CSS variable on the sprite root invalidated and
   re-painted every layer (~8ms per frame). Breathing/tail are inline transforms on their own layer;
   blink/ear/eye variables are set on the head layer only.
5. **No `forward: true` on `setIgnoreMouseEvents`.** On Windows that installs a system-wide low-level
   mouse hook that cost the main process ~15% of a core while the mouse moved. Hover is detected from a
   20Hz cursor poll instead.

### Privacy

The only activity signal is `powerMonitor.getSystemIdleTime()`, the OS-provided seconds since last
input. No screenshots, keystrokes, window titles or contents are read. Everything is stored locally in
`%APPDATA%/petonscreen/petonscreen-data.json`. The optional Claude API key is stored in that file and
is only used from the main process when you chat.

## Releasing for macOS

macOS apps can only be built, signed and notarized on macOS. Two ways to do that:

### A. Build on a Mac

1. Install Node 22 and Xcode command line tools (`xcode-select --install`).
2. Clone or copy the project, then `npm ci`.
3. For a quick unsigned test build (runs locally, Gatekeeper will ask you to right-click → Open):
   ```bash
   npm run dist:mac:unsigned
   open dist/PetOnScreen-0.1.0-arm64.dmg
   ```
4. For a release other people can download and open without warnings you need an Apple Developer
   account ($99/year):
   - In Xcode → Settings → Accounts, add your Apple ID and create a **Developer ID Application**
     certificate (or create it at developer.apple.com → Certificates).
   - Create an app-specific password at appleid.apple.com → Sign-In and Security.
   - Find your 10-character Team ID at developer.apple.com → Membership.
   - Export the certificate from Keychain Access as a `.p12` with a password.
   - Then:
     ```bash
     export CSC_LINK="$(base64 -i DeveloperID.p12)"
     export CSC_KEY_PASSWORD="the p12 password"
     export APPLE_ID="you@example.com"
     export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
     export APPLE_TEAM_ID="ABCDE12345"
     npm run dist:mac
     ```
   electron-builder signs with the hardened runtime and the entitlements in `build/`, uploads to
   Apple's notary service, staples the ticket, and writes `dist/PetOnScreen-<version>-arm64.dmg`
   and `-x64.dmg` (plus `.zip` files for auto-update tooling).

### B. Build in GitHub Actions (no Mac needed)

`.github/workflows/mac-release.yml` builds, signs and notarizes on a macOS runner and attaches the
DMGs to a GitHub Release.

1. Push the project to a GitHub repository.
2. Add the five secrets named in the workflow file (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). Without them the workflow still produces an
   unsigned build you can download from the run's artifacts for testing.
3. Tag a release: `git tag v0.1.0 && git push --tags`. The DMGs appear on the Release page.

### What the Mac build includes

- `LSUIElement` is set, so the app is a menu bar agent with no Dock icon and no Cmd-Tab entry.
- The pet window uses the `floating` level on macOS: above normal windows, below the menu bar,
  Spotlight and notifications. It shows on every Space and over full-screen apps.
- The menu bar icon is a template image that follows light/dark menu bars.
- Hardened runtime with the JIT entitlements Electron needs; not sandboxed. A Mac App Store build
  (`mas` target) would additionally need the App Sandbox and a provisioning profile and is not set
  up yet.
- Universal binaries are not used; separate Apple Silicon and Intel DMGs keep each download smaller.

The app icon comes from `build/icon.png`, generated by `npm run icon` (electron-builder converts it
to `.icns` and `.ico`).

## Dev tooling

`PETONSCREEN_SHOT_DIR=<dir> npx electron .` runs an isolated copy of the app (its own userData),
captures the pet window and each dashboard tab to PNGs, exercises a pet command and an event, then
exits. Handy for checking rendering without disturbing your desktop.

`PETONSCREEN_PERF=1 npx electron .` runs an isolated copy, samples per-process CPU in several
controlled states (static, pulsed frames at 5/10/30/60Hz, idle motion, free running) and exits.
`PETONSCREEN_METRICS=1 npm start` logs per-process CPU every 5 seconds for the real app.
`PETONSCREEN_SWGPU=1` forces software compositing for comparison.

Renderer console errors are forwarded to the main process stderr, so `npm start` shows them.
