# Mechapede — development and local play

A complete, single-player mechanical arcade game inspired by Atari's **Centipede upright arcade**. Cut through a convoy of compact conveyor units and mounted gears while runaway maintenance machines invade the field. Each unit has two rotating gears inside a moving tank tread, and any surviving unit can become the amber leader.

## Play locally

Requires Node.js 18.20 or newer. No dependency installation or build is needed to play.

```sh
npm start
```

Open **[http://localhost:5178](http://localhost:5178)**. If that port is occupied, use `PORT=5180 npm start` and open the port shown in the terminal. Keep the terminal running. The game loads no external fonts, images, audio or services and works offline once the local server is running.

## Controls

| Action | Control |
| --- | --- |
| Start / restart / resume | Enter, or the onscreen button |
| Move in both axes | Trackpad or mouse; captured relative motion with no cursor edges |
| Fire repeatedly | Hold Space or the primary pointer button |
| Alternate movement | WASD or arrow keys |
| Pause / resume | P; Escape also pauses |
| Mute | M or Sound button |
| Fullscreen | F or Fullscreen button |

**Trackball control is the default, with sensitivity 1.5×.** Click Engage Drive or press Enter in an active browser window. Play starts after pointer capture succeeds: the cursor stays hidden and repeated swipes continue beyond screen edges. A fast flick spins the virtual ball, carrying the tool across the board while friction gradually slows it. Gentle movements aim precisely; a slow correction or opposite swipe brakes the spin. Escape or P pauses, releases the pointer and stops all momentum. Changing windows also clears input and pauses.

Sensitivity and volume are beside the field and accessible while paused. Your chosen settings and personal best are saved locally; existing custom sensitivity is preserved. Keyboard movement stops immediately on release. Reaching an edge or gear stops spin into it, so reversing never has to work through accumulated overshoot.

Pause freezes the current board and releases the pointer. A small Resume control stays in the corner; press P or Enter, or click Resume, to continue from the same position.

If capture is declined, the game stays paused and offers Retry or **Use Window / Keyboard Controls**. For full trackball behavior on a Mac, use Chrome with its window active. Window controls track motion across the whole page, but remain limited by the screen/browser edges; leaving the window pauses safely. You can switch back with Enable Trackball. The game remains playable without Pointer Lock through this explicit fallback.

## Arcade rules

Three starting tools; an extra tool every 12,000 points, up to six spares plus the active tool. A leading link scores 100, a body link 10. Each gear takes four shots and scores 1 when removed. The crawler scores 300/600/900 depending on proximity; the dispenser scores 200 and takes two hits; the welding drone scores 1,000. Electrified gears disrupt a chain's steering. Gears persist between waves and are repaired after a lost tool.

The selected reference is the original upright arcade, revision 3, Easy settings. [Arcade reference and numerical constants](arcade-reference.md) distinguish confirmed rules from implementation limits. [Verification report](verification.md) records tests and browser limitations. Physical trackpad feel still needs your laptop playtesting.

## Source and verification

- `src/game.js`: seeded, deterministic 60 Hz gameplay; no DOM or graphics.
- `src/constants.js`: centralized gameplay constants in logical 240 × 256 coordinates, displayed in the upright CRT’s 3:4 aspect.
- `src/render.js`: twin-gear conveyor units with circulating tread shoes, mounted gear artwork, cached machine backdrop and mechanical lighting/effects.
- `src/tread-motion.js`: movement-driven wheel/tread phases retained through turns, pauses and splits.
- `assets/machine-interior.png`: generated industrial interior; [generation prompt and provenance](background-art.md).
- `src/chain-pose.js` and `src/gear-motion.js`: visual link articulation and gear rotation driven by passing links; no changes to simulation coordinates or collisions.
- `src/input.js`: relative pointer, keyboard, focus and capture handling.
- `src/audio.js`: original Web Audio sound synthesis.
- `src/main.js`: game loop, preferences, overlays and integration.
- `src/trackball-motion.js`: speed-sensitive flicks, friction and precision braking; `src/input.js` maps pointer events and keyboard input into fixed simulation ticks.

Run the rule tests with `npm test`. To run browser tests, install the development dependencies with `npm ci`, then `npx playwright install chromium webkit`. Keep `npm start` running and run `npm run test:browser`. The suite uses installed Chrome when available, falling back to Playwright Chromium. `GAME_URL` overrides the preview address.

For repeatable play use `/?seed=12345`. For controlled automation use `/?test=1&seed=12345`, which disables real-time stepping. `window.render_game_to_text()` returns readable gameplay state; `window.advanceTime(ms)` advances the fixed simulation and switches to manual time. `window.__chainDrive.setRealtime(true)` restores normal time. The development API also exposes deterministic scenarios (`game.debug('scenario', {name: 'crowded' | 'split' | 'poison' | 'enemies'})`). Scenarios are for verification, not extra game modes.

All game art and audio are original. No Atari sprites, ROM, audio or source code are bundled. This is an independent implementation, not a ROM emulator. GitHub Pages publishes the static game through `.github/workflows/pages.yml`; only HTML, CSS, SVG, `src/` and `assets/` are included in the site artifact.

Focused control checks: `npm run test:inertia` verifies flick distance, friction, braking, sensitivity and momentum resets in Chrome and WebKit. `npm run test:trackball` runs explicitly controlled Pointer Lock API lifecycle tests in both engines. `npm run test:trackball-native` runs actual capture/movement/release checks in headed Chrome; keep that Chrome window active on macOS. Use `?controls=window` when automating the uncaptured fallback.

Focused mechanical-art checks: `npm run test:mechanics` verifies ordinary obstacle contact, gear rotation, pause and split activation in Chrome and WebKit, with screenshots in `output/mechanics/`. Mounted gears turn as the conveyor units pass. Each unit's paired drive gears and tread shoes move together according to actual travel and freeze when paused.
