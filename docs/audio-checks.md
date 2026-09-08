# Audio verification

The soundscape in `src/audio.js` is original Web Audio synthesis: filtered noise,
inharmonic metal resonances, short motor sweeps, and quiet rhythmic machinery.
It has no recordings, external assets, or gameplay RNG dependencies.

## Checks performed

An isolated real Chromium page was exercised through Playwright on 2026-09-07.

- A browser button click activated `MechanicalAudio.unlock()` successfully and
  left its AudioContext in `running` state.
- A playing state containing chain sections, crawler, dispenser, and drone
  produced 18 short ambient voices. Changing the mode to `paused` removed all
  ambient voices, with no continued ambient scheduling.
- Mute was applied successfully, volume accepted `0.77`, and `suspend()` left the
  context in `suspended` state.
- All 17 event cues were rendered through the browser's `OfflineAudioContext`:
  fire, gear hit/destruction, link destruction, head activation, player death,
  extra life, game over, three supporting-enemy spawns, electrification, wave
  start, crawler death, dispenser hit/death, and drone death.
- Every cue produced a nonzero finite waveform. No individual cue clipped at
  maximum volume: the highest absolute sample was 0.2922 for a destroyed link,
  even with the normal output limiter omitted from the offline test.
- `node --check src/audio.js` passed.

The event API accepts both hyphenated engine event names and camel-case names.
Ambient audio follows browser audio time rather than simulation time, avoiding
sound backlogs during deterministic accelerated gameplay tests. Short cue
envelopes, event throttling, a 48-voice cap, restrained master gain, and an output
compressor control density and level. The module creates no AudioContext until
an explicit `unlock()` call.

## Limits

These checks establish browser activation, synthesis output, level bounds, and
pause/mute control behavior. They are not a subjective listening assessment of
laptop speakers or headphones. Safari audio behavior has not been independently
tested here. The module recognizes Safari's prefixed AudioContext constructor
and interrupted context state. Full-game keyboard mute, preference persistence,
and volume UI checks belong to the game integration report.
