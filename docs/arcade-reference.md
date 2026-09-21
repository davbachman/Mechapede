> Historical reference for the archived Classic implementation (Git tag `archive/classic-2026-09-21`). The current game uses connected sides, a piston gantry, gravitational flywheels and falling gears; see [current rules](development.md). Descriptions below record the original research, not the current enemy cast.

# Mechapede — arcade reference

Research date: 2026-09-08. Target: Atari **Centipede upright arcade, revision 3**, single player, **Easy**, **3 starting lives**, bonus at **each 12,000 points**. These are the TM-182 operator manual's recommended settings. The maximum is **six reserve lives plus the active carriage: seven playable lives**. No home-console or browser-clone rules were used.

## Evidence

- [Atari TM-182 operator manual, pp. 10, 13–16](https://manualzz.com/doc/4124553/atari-centipede-operation--maintenance-and-service-manual): cabinet settings, basic play, enemy introduction and scoring. [Original scan](https://r.mprd.se/MAME/manuals/arcade/centiped.pdf).
- [Ed Logg's May 13, 1981 gameplay document](https://github.com/historicalsource/centipede/blob/main/CENTIP.DOC): rapid fire whenever the shot becomes available, wave alternation, six-life cap, poisoned-head recovery, mushroom repair.
- [Atari revision 3 gameplay source](https://github.com/historicalsource/centipede/blob/main/revision.v3/CENTI3.MAC) and [definitions](https://github.com/historicalsource/centipede/blob/main/revision.v3/CENDEF.MAC): primary numerical evidence. Routine names below identify the relevant code. Numbers without a trailing dot in this assembly are **hexadecimal**. Comments occasionally retain obsolete values; executed instructions take precedence.
- [MAME's Centipede hardware driver](https://github.com/mamedev/mame/blob/master/src/mame/atari/centiped.cpp): 60 Hz, 256×240 visible raster before rotation; hence 240×256 upright logical pixels, 30×32 tiles of 8×8 pixels.
- [MAME's screen implementation](https://github.com/mamedev/mame/blob/master/src/emu/screen.cpp): the raster CRT's physical aspect defaults to 4:3; rotated upright, this is **3:4**, distinct from the native logical raster's 240:256 ratio. Its pixels are not physically square.
- [Revision 3 arcade footage by hirudov](https://www.youtube.com/watch?v=QO_Kx4o1kXw): visually inspected at 0:18, 0:38 and 0:58. These show the compact connected formation, independent heads, a single narrow shot, changed wave palette, and persistent damaged obstacles. These observations supplement the original code; they are not a frame-timing measurement.

## Confirmed rules and numerical targets

All speeds below are **logical pixels per 60 Hz simulation step**. Rendering, particles, sprocket animation and sounds must not change these rules.

| System | Arcade target | Source routine |
| --- | --- | --- |
| Player | Two axes, no inertia; capped at 4 pixels/step per axis, with fractional input retained; mushrooms block motion | `MOVE`, `TBLMT` |
| Player region | Original vertical coordinate 8–48 above the bottom, a 40-pixel center-travel span; normalized here to centers y212–252, sharing the conveyor's bottom row | `MOVE` |
| Shot | One projectile slot; upward speed **7**; holding fire reuses it when removed or returned, without a separate long cooldown | `SHOOT`, `RSHOT` |
| Chain | 12 total segments; ordinary segment spacing 8 pixels; initial formation near top center | `INIT`, `CENTPC` |
| Speeds | First wave 2; slow chain 1; fast chain and independent heads 2; the final remaining link becomes fast | `INIT`, `CENTPC`, `MOTION` |
| Starting field | 46 placement attempts, one random column for each successive row 27 down to 2, then repeat; repeated cells collapse | `INITSC` |
| Gear damage | Four hits; 1 point only when destroyed; normal and poisoned versions have four damage states | `SHOOT` |
| Repair | Each damaged or poisoned surviving gear becomes full and normal after death; 5 points per restored gear | `RESTOR` |
| Flea | 2 hits; base speed 2, speed 3 from 60,000; first hit changes speed to 4; 200 points | `ANTPC`, `SHOOT` |
| Flea deposits | 25% chance every four simulation frames; adds only to an empty eligible tile | `ANTMV`, `MUSHER` |
| Spider | Speed 1 on Easy initially, then 2 around 5,000; diagonal 45° or vertical motion; reconsider direction every 48 frames | `BUGOFF`, `BUGMV` |
| Spider timing | Initial/edge-exit entry wait 96 frames; death wait 128 frames | `BUGOFF`, `SHOOT` |
| Spider score | **Vertical** distance to player: below 22 pixels = 900; 22–63 = 600; 64 or more = 300 | `SHOOT` |
| Scorpion | Horizontal speed 1; from 20,000, 75% chance of speed 2; 1,000 points | `SCORP` |
| Extra lives | Every 12,000; six reserve lives maximum, plus active carriage; a bonus missed at the cap is not banked and makes no bonus sound | `START`, `SCORNG`, `CHKEND` |

## Chain behavior

- Before 40,000 points, the wave sequence is **12 fast**, **11 slow + 1 fast head**, **11 fast + 1 fast head**, **10 slow + 2 fast heads**, **10 fast + 2 fast heads**, and so on. From 40,000, every wave is fast and removes another segment from the main formation. After the all-head formation, the cycle starts with a full chain again. This is not a simple speed increase every wave.
- Heads turn at boundaries and obstacles. A turn occupies one 8-pixel row: horizontal and vertical motion occur together and horizontal direction reverses halfway through. Body links follow the preceding link's turn. Heads also check overlap with other segments.
- A hit removes exactly one link, awards body 10/head 100, and activates the next surviving body link as a head immediately. The activation itself does **not** create a link, change velocity, or force a teleport. The new obstacle subsequently makes the new head turn when approached.
- A poisoned head ignores ordinary steering and repeatedly descends. Poison clears at the bottom. Shooting that head also stops the poison because its following body link becomes an ordinary head.
- At the bottom, sections travel upward, staying in the player's lower region. A section can release its tail into an independent reversed head when that tail is also on the bottom row. This can recur on later visits; it is not a once-per-section ability.
- Bottom arrival enables replacement heads entering from a side roughly 64 pixels above the bottom. They use vacant slots, so at most 12 segments are active. Initial wait is 192 frames; subsequent waits shorten by 8 and also shorten with score. This pressure persists across waves. The source's below-96 comparison allows a nominal floor of **88** frames, not exactly 96.

The gap after the last link is destroyed lasts 64 frames. Supporting enemies persist and remain active during it; player movement and shooting also continue. Only the next chain is delayed (`CHKEND`, `MOVE`, `BUGMV`, `ANTMV`).

## Obstacles and supporting enemies

Gears persist between waves; a new game generates a new field. On life restart, the field is repaired, surviving poison is removed, and the current formation is rebuilt at the top. A destroyed link deposits a normal full gear only into an empty eligible cell. `SHOOT` uses `CALLS`/`OBSTAC`, which selects the tile one step forward in that link's direction. Existing damaged/electrified gears are not overwritten. No new gear is deposited on the bottom player row, unused boundary row or score row. Spider contact removes gears without points.

Death restoration follows the roughly 32-frame player explosion, then repairs one eligible gear per eight frames. Empty and intact tiles do not add another repair interval. The death countdown pauses while this scan runs (`EXPLOD`, `RESTOR`, `CHKEND`).

The flea starts on formations shorter than 12 (first eligible wave 2). It counts obstacles in the **bottom eleven tile rows**, a larger region than the player's movement band. It appears when the count is at most 5 below 20,000, or at most 9 from 20,000 to 119,999. Flea and scorpion share one object slot: they never coexist.

The scorpion first becomes eligible when the main formation has fewer than 11 links (wave 4). When the shared slot is free, it gets a 25% entry chance every 256 frames; it crosses an upper row, approximately 24–144 pixels from the top, and poisons touched gears.

The spider spans roughly the bottom 96 pixels initially, rather than being confined to the player's band. Its upper boundary contracts in 8-pixel steps at 80k, 100k, 120k, 140k and 160k to a final 56-pixel band. The manual describes this progression as starting at 60k. Direction changes are random, with more frequent reversals in Hard mode.

## Collision and fidelity boundaries

The original uses compact numerical windows, not sprite-alpha collisions. Player versus chain/flea uses `abs(dx)<7`, `abs(dy)<7`, `abs(dx)+abs(dy)<12`; spider uses horizontal `<10`, vertical `<7`, sum `<14`. Shot collision first checks the original obstacle row derived from the previous shot position, then tests the new position against spider, shared flea/scorpion, and fixed chain slots 11 down to 0. Chain/flea shot windows are horizontal `<6`, vertical `<5`; a flea already accelerated by a hit uses vertical `<7`. Spider/scorpion shot windows are horizontal `<10`, vertical `<5`. The themed artwork must remain readable around these small gameplay bounds.

**Bottom-row clearance (rechecked 2026-09-19):** `MOVE` and `INIT1` put the upright shooter at V=8 at the bottom; `MOTION` places the lowest two horizontal chain rows at V=8 and V=16. `PLAY` compares those coordinates directly, rejecting vertical separations of 7 or more. Thus a shooter on the lowest row fits safely below a chain one row above, but still collides with one on its own row. Mechapede keeps its existing conveyor centers at y252/y244 and now gives the shooter the same y252 bottom center. The previous y248 limit erroneously placed it halfway between both rows. Moving its full travel band down four pixels preserves the original 40-pixel span and the collision windows; this restores relative alignment without claiming bit-exact hardware sprite placement.

This is an independent browser implementation, not a ROM emulator. Source inspection established the rules above; exact POKEY randomness and every 6502 update-order detail were not experimentally reproduced. The flea threshold from 120k uses a binary shift of a packed-BCD score byte, giving 15 at 120k; Mechapede preserves that formula. Replacement-head score adjustments and extreme-score spider bounds use ordinary arithmetic rather than reproducing every decimal-mode artifact. Followers use leader-position history rather than the original per-body row comparison. Hardware sprite anchors are normalized to the new artwork's logical centers. Those are implementation approximations around the researched numerical windows and turn durations. Projectile row lookup, strict collision windows and fixed object-slot priority follow the original; chain/crawler collision with the player takes precedence over same-frame shooting.

**Life-counter interpretation:** the original gameplay prose's six lives refers to the reserve counter. Revision 3 `START` stores three starting lives as two reserves, explicitly excluding the active shooter. `CHKEND` allows another respawn whenever that counter is positive; `SCORNG` caps it at six. Mechapede therefore permits seven total while playing. During death repair there is no active carriage, so the maximum remaining is six reserves. Executed source resolves the prose's ambiguity.

Trackpad sensitivity, modern pause/focus handling, preferences, mechanical artwork and audio are presentation/input adaptations. The user-requested virtual trackball now adds decaying spin to fast swipes, with precision/reversal braking, while retaining the original per-tick movement cap and collision checks. Physical trackpad feel still requires laptop playtesting; automated relative-pointer tests cannot establish it.

## Optional Cylinder variant

Classic remains the arcade reference mode. Cylinder is a user-requested gameplay variation: the horizontal coordinate is periodic with circumference 240 logical pixels. The shooter and moving enemies wrap across that seam, with periodic collision distances and gear lookup. Moving sprites are visible on both edges while crossing. Player movement retains the four-pixel per-axis step cap and y212–252 band; crossing a seam does not consume trackball momentum.

During unobstructed travel, conveyors slope by 8/240 logical pixels vertically per horizontal pixel. A full horizontal lap therefore changes height by exactly one row, without any additional height jump at the seam. Gear encounters still trigger turns. On reaching y252, a section clears poison and slopes upward through the player region, then downward again at y212. This bottom behavior was explicitly chosen by the user. Followers retain their own identities and follow the same recorded path across the seam; splitting does not teleport them. Cylinder has a separate saved personal best, and the variant is selected before starting a new game.
