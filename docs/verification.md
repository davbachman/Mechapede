# Mechapede — verification

Latest checks: 2026-09-19. **106 rule, stability, mechanical-motion and trackball tests passed; all 29 general browser, 14 controlled pointer-capture and 12 Cylinder checks passed in each of Chrome and WebKit with no uncaught runtime errors.** Earlier focused mechanical-art, tread, clearance and inertia checks are recorded below. Launch with `npm start`, then open [localhost:5178](http://localhost:5178).

| Area | Checks performed |
| --- | --- |
| Flow | Enter/button start, pause/resume, focus loss, death, sequential repairs, live wave intervals, wave progression, game over, restart and persistent high score |
| Controls | Relative movement on both axes, precision aiming, flick coasting and braking, simultaneous firing, button/keyboard release, pointer entry/exit without jumps, no Space scrolling, WASD/arrows, sensitivity, volume/mute persistence and fullscreen |
| Chain | Initial formation, boundary/gear turns, head/middle/tail hits, surviving identities and counts, immediate activation without immunity, independent/single links, bottom tail release and replacement-head pressure |
| Gears and supporting enemies | Four damage states, creation, persistence, repair, electrification and poisoned steering; crawler movement/removal/proximity scores; dispenser spawn/deposits/two hits; drone eligibility/traversal/electrification; shared enemy slot |
| Arcade scoring and difficulty | Source-based projectile tile lookup and stable object-slot priority, original hit windows and single-shot restriction; 12,000-point awards, six spare tools plus active tool, reserve cap during repair; alternating wave speed/formation and score thresholds |
| Timing and stability | Matching engine and buffered pointer results at 30/60/120 Hz; real-time animation loop; ten seeded ten-minute runs (360,000 steps) checking finite coordinates, bounds, unique IDs, ≤12 links, valid leader/gear/score/life state and enemy slots |
| Visuals and sound | Screenshots opened and inspected for title, active play, turns, splits, all enemies and crowded lower-field heads. Same-shape steel links, amber head lights, readable damage/electrical states and tool effects. User-gesture audio activation; 17 synthesized event families produced nonzero signals below clipping; pause silenced ambient voices |

The final display preserves the upright CRT's **3:4 presentation** over **240×256 logical coordinates**. Layout and pointer scaling were checked at 1440×900, 1280×800 and 1100×720, including DPR 1 and 2. The documented local server command was independently launched on another port and verified to serve HTML and ES modules.

Reproduce with `npm test` and `npm run test:browser` (see [README](../README.md) for browser prerequisites). The prescribed develop-web-game client was also run through multiple movement/shooting bursts, with JSON state and screenshots inspected. Machine-readable results are in `output/browser/report.json`; screenshots are alongside it and in `output/final/`. [Audio audit](audio-checks.md) records the signal checks.

## Remaining limits

- **Browsers:** actual Google Chrome **153.0.8010.50** and Playwright WebKit **26.0** passed the latest checks. On September 8, installed Safari **26.6.2** could not create a WebDriver session because “Allow remote automation” was disabled. No settings were changed; actual Safari has not been reverified. WebKit coverage is useful evidence, not an actual Safari pass.
- **Pointer capture:** before the inertia update, six groups of native Chrome checks verified trusted motion beyond a 1,280-pixel viewport to x=3,500, reversal, Escape release/input clearing and resume recapture. The earlier `WrongDocumentError` came from Chrome lacking native macOS key-window focus; JavaScript focus alone was insufficient. Default play waits for confirmed capture. Blocked capture pauses with an explicit window/keyboard fallback. After adding inertia, all fourteen controlled API lifecycle checks passed again in each of Chrome and WebKit; these cover modern/legacy APIs, constant client coordinates, bounds/reversal, focus loss, cancellation and late grants. Embedded preview capture still depends on its host; native capture with the new inertia still needs a physical trackpad trial.
- **Hardware feel:** automated movement verifies deltas, sensitivity, scaling and release, but cannot establish physical finger feel. Real trackpad sensitivity and subjective sound balance need your playtesting.
- **Fidelity:** primary arcade sources guided the rules. This is an independent implementation, not a ROM emulator: seeded randomness replaces POKEY, followers use recorded leader motion, and extreme-score arithmetic/normalized sprite anchors have documented limits. See [arcade reference](arcade-reference.md). The user-requested trackball inertia is an input adaptation.

The whole-window fallback was separately retested in both engines: movement and held-button shooting continue outside the canvas with no cursor reappearance; actual window exit pauses safely. The 29-check browser suite passed again after this update. Pointer capture is based on the [Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API); browser success is confirmed by `pointerlockchange`, including legacy browsers whose request returns no promise.

## Chain and gear artwork update

Replaced the separate oval sprites and center bars with hollow forged-steel loops that overlap in alternating planes. Loop ends articulate through tight turns to keep the chain connected. Existing link drives and amber indicators still activate on promotion, including thin-view and single-link leaders.

Gears now have beveled teeth, spokes and a witness mark rotating around a fixed mounting axle. Motion follows the nearby links, continues as followers pass, stops when contact ends, and retains its angle. Render-only seating brings the loop against the teeth during a turn; authoritative movement, timing, link identities and hitboxes remain unchanged.

Twelve gear-motion regressions cover direction, followers, stop/pause, redraw independence, reset/deletion, separate sections, teleports, real obstacle turns and clearance. A focused natural-approach test caught an initial contact gap missed by the adjacent-head scenario. The final twelve-link encounter drives the gear on 30 of 60 sampled frames in both Chrome and WebKit. Repeated rendering leaves exact gameplay state and gear angle unchanged.

`npm run test:mechanics` captures straight chains, close tooth contact, turns, splits, crowded heads, poison and all four normal/electrified damage states. Screenshots were opened and inspected in `output/mechanics/`. The final develop-web-game playthrough (`output/chain-final/`) also passed with no reported errors.

## Machine interior and console update

Added a generated 3:4 machine-interior backdrop with copper windings, relays, exposed wiring and worn steel. The central backplate stays quiet; small light pools and edge machinery give depth behind game objects. Runtime lighting is restrained and stops with the simulation while paused. The original PNG is saved in `assets/machine-interior.png`; [exact prompt and provenance](background-art.md).

The cabinet, score windows, enamel operator panel, buttons and sliders received physical metal shading and fasteners. Desktop layouts were inspected at 1280×800, 1440×900 and 1024×768, with a 390px narrow-layout check. Gameplay dimensions and input mapping are unchanged.

Chrome 152 and WebKit 26 again passed all 29 general browser checks without runtime/console errors. Focused integration checks confirmed the generated image loads, backing image cache matches resized canvases, paused state and pixels remain identical, no horizontal overflow occurs, and the game stays playable if the image fails to load. Screenshots of title, active play and crowded lower-field heads were opened and inspected at `output/machine/`; the prescribed skill-client run is in `output/machine-first/`.

## Available-screen sizing update

The actual playing surface now starts at the window's top edge and uses the full available height, limited only by the 3:4 aspect ratio and available width. Branding, sound/fullscreen, scores, lives and pause live in the controls panel. On narrow windows the board comes first at full available width, with the panel below. The panel scrolls internally on short desktop screens.

Removed arbitrary height caps, the decorative page footer and the header/HUD/footer bands above and below the board. Measured viewport fitting updates on resize and fullscreen changes, including separate horizontal and vertical cabinet borders.

Chrome 152 and WebKit 26 each passed all 29 general browser checks, including controls, fullscreen and pointer scaling. Dedicated measurements confirmed canvas top=0, exact 3:4 aspect, no horizontal overflow and full-height desktop play at 1280×700, 1024×683 and 1512×982, plus narrow layouts at 514×683 and 390×844. The 1512×982 board is now 736.5×982. Screenshots were opened and inspected in `output/top-edge/` and the prescribed gameplay client capture in `output/top-edge-skill/`.

The game also resets stale page scroll on load. Reloading after scrolling down to narrow-layout controls was tested in both browser engines; the board returns to y=0. The user's live514×683 preview was checked at511.875×682.5 with scrollY=0.

## Conveyor units

The enemy artwork now uses a complete conveyor assembly for every segment: two round drive gears enclosed by a continuous tank tread with moving metal shoes. All units share the same construction, with amber gears, a rail and an existing indicator identifying the leader. Short articulated drawbars connect the convoy. Original movement, collision positions, splitting and scoring remain unchanged.

Wheel rotation and tread travel follow actual displacement, including turns and direction changes. Stable unit IDs retain animation phase after splitting and promotion. Mounted gears now respond to the actual tread capsules; gaps and drawbars cannot drive them. The natural twelve-unit encounter gives twelve contact frames in both browsers, with ordinary contacts within 0.084 logical screen units of the gear teeth.

Nine tread-motion tests and fifteen mounted-gear tests pass alongside the original rule/stability tests (71 total). `npm run test:treads` passes eight production-render checks in each of Chrome and WebKit: all twelve moving units rotate their drawn gears, redraws do not change state/phase, pause preserves exact canvas pixels, resume continues the same phase, splits preserve surviving identities, gears remain round through 27 turning frames and narrow resizing, and no runtime errors occur. The 29 general browser checks and focused mechanics checks also passed.

Straight, moving, turning, split, pause, damage/electric and narrow screenshots were opened and inspected in `output/treads/` and `output/mechanics/`. The final prescribed gameplay client capture is in `output/treads-final/`.

## Trackball inertia

The user requested momentum, superseding the original no-drift preference. Default sensitivity is now 1.5×; existing custom settings remain saved. Timestamped pointer strokes establish a bounded spin velocity that decays with friction. Small movements remain precise, and slow or opposite corrections brake immediately. Spin is integrated at each fixed simulation tick while preserving the original movement cap and gear collisions. Bounds, obstacles, pause, focus/capture changes, resize, death and new lives clear the relevant momentum.

Ten new motion-model tests pass, bringing the unit/rule/stability total to 81. `npm run test:inertia` passes nine checks in each of Chrome 152 and WebKit 26. An equal-distance 24-logical-pixel stroke travels 35.73 pixels when delivered over 600 ms, versus 152.66 pixels over 40 ms, including 144.66 pixels of continued travel after the fast stroke ends. Released spin travels identically at 30/60/120 Hz. Tests also cover sensitivity persistence, braking, collisions and lifecycle resets. These use timestamped synthetic mouse events through production controls; they do not establish hardware feel.

The general browser suite now holds the pause button for 120 ms before releasing it. This exposed an intermittent WebKit click loss caused by replacing the button's children every frame; the button now updates only when its label changes. Gameplay, flick and paused screenshots were opened and inspected in `output/inertia/` and the prescribed client capture in `output/trackball-inertia-final/`. The final client run used a temporary copy selecting installed Chrome and its normal renderer after bundled Chromium with forced SwiftShader stalled; the same movement/shooting workflow completed with no errors. Machine-readable inertia results are in `output/inertia/report.json`.

## Bottom-row clearance — 2026-09-19

The original arcade shooter can sit one row below a horizontal centipede. The previous shooter limit y248 was halfway between Mechapede's two lowest conveyor rows (y244/y252), so both rows were within collision range. Its movement band is now y212–252, preserving the 40-pixel span and existing collision thresholds. The conveyor's top rebound row remains y212. A shorter carriage with a broader chassis fits fully inside the bottom and side edges, with a visible gap below the row above.

The new overhead-pass regression failed before the fix. Afterward, all 84 unit/rule/stability tests pass, including both convoy directions/speeds, head/body clearance, same-row collisions and the strict vertical threshold. All 29 general browser and 14 controlled pointer-capture checks also passed per engine. `npm run test:clearance` passes seven focused checks in Chrome 153 and WebKit 26 at both 1280×800 and 514×683: startup, travel span, six-unit overhead passes, same-row danger, one/two-pixel upward corrections, firing into the overhead row and corner movement. Lower-board and full screenshots in `output/player-clearance/` were opened and inspected for clearance and clipping; no runtime errors occurred. The prescribed gameplay-client artwork check is in `output/compact-shooter-art/`.

## Optional Cylinder mode — 2026-09-19

The title and game-over screens offer Classic and Cylinder, remember the selection and retain separate best scores. Classic remains the default for a fresh visit. In Cylinder, moving objects cross the connected side edges. Unobstructed conveyor travel slopes eight logical pixels vertically per 240 horizontal pixels in either direction; the seam adds no vertical displacement. After reaching y252, the convoy slopes upward through the player region, reflecting downward again at y212. Mounted gears still trigger the existing obstacle turns.

Sixteen simulation checks cover exact lap slope, both seams, bottom/top reflection, poisoned turns, wrapped gear addressing and collision windows, follower identity after splits, enemy ingress and repeated wrapping, an unobstructed 12,000-frame journey, and seeded sustained play. Six artwork checks cover articulation, short drawbars, tread phase, gear engagement and edge copies. All 106 tests passed, including the unchanged Classic regressions.

`npm run test:cylinder` passed twelve groups in Chrome 153.0.8010.50 and WebKit 26.0. Browser checks confirm mode persistence, score separation, keyboard and inertial wrapping, both travel directions, collision and shooting across the seam, and exact paused pixels and wheel phases. A spinning shooter continued from x239 through x3 to x7 without losing velocity. A seam-straddling convoy changed pixels on both edges and zero pixels in the central test strip, ruling out a board-spanning connector. Screenshots of active play, both edges, pause and the complete picker at 514×683 were opened and inspected in `output/cylinder/` and `output/cylinder-art/`; the prescribed gameplay-client capture and state are in `output/cylinder-art-skill/`.

All 29 general browser and fourteen controlled pointer-capture checks passed again in both engines. These browser results use automation; the actual Safari and physical-trackpad limitations above still apply. Cylinder is an intentional gameplay variant, rather than part of the original arcade reference.
