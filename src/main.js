import { Game } from "./game.js";
import { C } from "./constants.js";
import { Renderer } from "./render.js";
import { Controls } from "./input.js";
import { MechanicalAudio } from "./audio.js";
const $ = (id) => document.getElementById(id);
const storage = {
  get(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem("chain-drive." + key));
      return v ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("chain-drive." + key, JSON.stringify(value));
    } catch {
      /* Private browsing remains playable. */
    }
  },
};
const numberPref = (key, def, min, max) => {
  const n = Number(storage.get(key, def));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};
const params = new URLSearchParams(location.search);
// A game opens on its board, even if a narrow preview was previously scrolled
// down to the controls before a reload or layout update.
history.scrollRestoration = "manual";
window.scrollTo(0, 0);
window.addEventListener("pageshow", () => window.scrollTo(0, 0), {
  once: true,
});
const suppliedSeed = params.has("seed")
  ? Number(params.get("seed")) >>> 0
  : null;
const canvas = $("game"),
  game = new Game({ seed: suppliedSeed ?? Date.now() >>> 0 });
let best = numberPref("high-score", 0, 0, 999999999);
const audio = new MechanicalAudio({
  muted: !!storage.get("muted", false),
  volume: numberPref("volume", 0.45, 0, 1),
});
function fitPlayfield() {
  const machine = $("machine"),
    layout = document.querySelector(".console-layout"),
    cabinet = document.querySelector(".cabinet"),
    sidebar = document.querySelector(".sidebar");
  const stacked = matchMedia("(max-width: 760px)").matches;
  const machineStyle = getComputedStyle(machine),
    cabinetStyle = getComputedStyle(cabinet);
  const verticalBorders =
    parseFloat(cabinetStyle.borderTopWidth) +
    parseFloat(cabinetStyle.borderBottomWidth);
  const horizontalBorders =
    parseFloat(cabinetStyle.borderLeftWidth) +
    parseFloat(cabinetStyle.borderRightWidth);
  // Scores and controls live beside the board. Use the complete window height;
  // document coordinates keep scrolling through narrow-layout controls stable.
  const top =
    layout.getBoundingClientRect().top +
    (document.fullscreenElement ? 0 : scrollY);
  const roomHeight =
    innerHeight -
    top -
    verticalBorders -
    parseFloat(machineStyle.paddingBottom);
  const roomWidth =
    layout.clientWidth -
    horizontalBorders -
    (stacked
      ? 0
      : sidebar.getBoundingClientRect().width +
        parseFloat(getComputedStyle(layout).columnGap));
  const height = Math.max(
    1,
    Math.floor(Math.min(roomHeight, roomWidth / 0.75) * 4) / 4,
  );
  machine.style.setProperty("--field-height", `${height}px`);
  machine.style.setProperty(
    "--cabinet-height",
    `${height + verticalBorders}px`,
  );
}
fitPlayfield();
const renderer = new Renderer(canvas);
const input = new Controls(canvas, {
  getMode: () => game.state.mode,
  onAction: handleAction,
  sensitivity: numberPref("sensitivity", 1.5, 0.35, 2.5),
});
let manual = new URLSearchParams(location.search).has("test"),
  accumulator = 0,
  last = performance.now(),
  shownMode = "",
  captureState = "idle",
  captureToken = 0,
  captureWanted = false,
  captureTimer = null,
  captureError = null;
let controlMode =
  params.get("controls") === "window"
    ? "window"
    : storage.get("control-mode", "trackball");
if (!["trackball", "window"].includes(controlMode)) controlMode = "trackball";
function unlock() {
  audio.unlock().then((ok) => {
    if (!ok) $("mute-button").title = "Audio unavailable in this browser";
  });
}
function handleAction(action) {
  if (action === "audio") {
    unlock();
    return;
  }
  if (action === "start") {
    if (game.state.mode === "paused") {
      resume();
      return;
    }
    if (["title", "gameover"].includes(game.state.mode)) {
      input.clear();
      renderer.particles = [];
      renderer.labels = [];
      if (suppliedSeed === null && !params.has("test"))
        game.seed = crypto.getRandomValues(new Uint32Array(1))[0];
      game.start();
      game.state.highScore = Math.max(best, game.state.highScore || 0);
      unlock();
      canvas.focus({ preventScroll: true });
      accumulator = 0;
      shownMode = "";
      if (controlMode === "trackball") {
        game.pause();
        requestTrackball();
      }
      draw(0);
    }
    return;
  }
  if (action === "escape") {
    cancelCapture();
    pause();
    draw(0);
    return;
  }
  if (action === "pause") {
    if (game.state.mode === "paused") resume();
    else pause();
    return;
  }
  if (action === "blur" || action === "pointer-exit") {
    cancelCapture();
    pause();
    return;
  }
  if (action === "mute") {
    audio.setMuted(!audio.muted);
    storage.set("muted", audio.muted);
    syncPrefs();
    return;
  }
  if (action === "fullscreen") {
    toggleFullscreen();
    return;
  }
  if (action === "capture-enter") {
    if (!captureWanted) {
      document.exitPointerLock();
      return;
    }
    clearTimeout(captureTimer);
    captureState = "locked";
    captureError = null;
    finishResume();
    syncCaptureUI();
    return;
  }
  if (action === "capture-exit") {
    cancelCapture();
    pause();
    syncCaptureUI();
    return;
  }
  if (action === "capture-error") captureFailed();
}
function cancelCapture() {
  captureWanted = false;
  captureToken++;
  clearTimeout(captureTimer);
  captureState = "idle";
}
function captureFailed(error) {
  if (captureState !== "requesting") return;
  clearTimeout(captureTimer);
  captureWanted = false;
  captureError = error?.message || "The browser declined pointer capture.";
  captureState = "blocked";
  input.clear();
  syncCaptureUI();
  shownMode = "";
  draw(0);
}
function requestTrackball() {
  if (input.captured || captureState === "requesting") return;
  const token = ++captureToken;
  captureWanted = true;
  captureState = "requesting";
  captureError = null;
  input.clear();
  canvas.focus({ preventScroll: true });
  syncCaptureUI();
  // Invoke in the original click/keypress, before any await can lose user activation.
  try {
    if (!canvas.requestPointerLock)
      throw new Error("Pointer capture is unsupported.");
    const result = canvas.requestPointerLock();
    // Legacy WebKit returns void: only pointerlockchange confirms success.
    result?.catch((error) => {
      if (token === captureToken) captureFailed(error);
    });
    captureTimer = setTimeout(() => {
      if (token === captureToken && !input.captured) captureFailed();
    }, 5000);
  } catch (error) {
    captureFailed(error);
  }
}
function syncCaptureUI() {
  $("capture-button").textContent =
    captureState === "locked"
      ? "TRACKBALL CONNECTED"
      : captureState === "requesting"
        ? "CONNECTING TRACKBALL…"
        : captureState === "blocked"
          ? "RETRY TRACKBALL ↗"
          : "ENABLE TRACKBALL ↗";
  $("capture-button").disabled = ["requesting", "locked"].includes(
    captureState,
  );
  $("capture-note").textContent =
    captureState === "locked"
      ? "Continuous motion. Escape releases & pauses."
      : captureState === "blocked"
        ? "Capture denied. Try this game in an active Chrome window."
        : controlMode === "window"
          ? "Window controls stop at screen edges. P pauses."
          : "Start captures the pointer. Escape releases & pauses.";
  $("window-controls-btn").textContent =
    controlMode === "trackball"
      ? "USE WINDOW / KEYBOARD CONTROLS"
      : "USE TRACKBALL CONTROLS";
}
function pause() {
  cancelCapture();
  if (["playing", "dying", "wave"].includes(game.state.mode)) game.pause();
  input.clear();
  audio.stop();
  if (input.captured) document.exitPointerLock();
  syncCaptureUI();
  draw(0);
}
function resume() {
  if (game.state.mode !== "paused") return;
  if (controlMode === "trackball" && !input.captured) requestTrackball();
  else finishResume();
}
function finishResume() {
  if (game.state.mode === "paused") game.resume();
  input.clear();
  accumulator = 0;
  last = performance.now();
  unlock();
  canvas.focus({ preventScroll: true });
  shownMode = "";
  draw(0);
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($("machine").requestFullscreen)
      await $("machine").requestFullscreen();
    else
      $("capture-note").textContent = "Use your browser’s fullscreen command.";
  } catch {
    $("capture-note").textContent = "Fullscreen unavailable in this browser.";
  }
}
$("start-btn").addEventListener("click", () => handleAction("start"));
$("pause-button").addEventListener("click", () => {
  handleAction("pause");
  if (game.state.mode !== "paused") canvas.focus({ preventScroll: true });
});
$("mute-button").addEventListener("click", () => {
  handleAction("mute");
  if (game.state.mode === "playing") canvas.focus({ preventScroll: true });
});
$("fullscreen-button").addEventListener("click", () =>
  handleAction("fullscreen"),
);
$("sensitivity").addEventListener("input", (e) => {
  input.clear();
  input.sensitivity = Number(e.target.value);
  storage.set("sensitivity", input.sensitivity);
  syncPrefs();
});
$("volume").addEventListener("input", (e) => {
  audio.setVolume(Number(e.target.value) / 100);
  storage.set("volume", audio.volume);
  unlock();
  syncPrefs();
});
for (const el of [$("sensitivity"), $("volume")])
  el.addEventListener("pointerdown", () => pause());
$("capture-button").addEventListener("click", () => {
  controlMode = "trackball";
  storage.set("control-mode", controlMode);
  if (["title", "gameover"].includes(game.state.mode)) handleAction("start");
  else {
    if (["playing", "wave", "dying"].includes(game.state.mode)) game.pause();
    requestTrackball();
  }
});
$("window-controls-btn").addEventListener("click", () => {
  controlMode = controlMode === "trackball" ? "window" : "trackball";
  storage.set("control-mode", controlMode);
  cancelCapture();
  syncCaptureUI();
  handleAction("start");
});
function syncPrefs() {
  $("sensitivity").value = input.sensitivity;
  $("sensitivity-output").value = input.sensitivity.toFixed(2) + "×";
  $("volume").value = Math.round(audio.volume * 100);
  $("volume-output").value = Math.round(audio.volume * 100) + "%";
  $("mute-button").textContent = audio.muted ? "SOUND OFF" : "SOUND ON";
  $("mute-button").setAttribute(
    "aria-label",
    audio.muted ? "Unmute sound" : "Mute sound",
  );
  $("mute-button").setAttribute("aria-pressed", String(audio.muted));
}
function consumeEvents() {
  const events = game.drainEvents();
  if (
    events.some((event) =>
      ["player-death", "life-start", "game-over"].includes(event.type),
    )
  )
    input.clear();
  renderer.events(events);
  for (const event of events) audio.play(event);
}
function simulate(seconds) {
  accumulator += seconds;
  const steps = Math.floor((accumulator + 1e-9) / C.STEP);
  if (!steps) return;
  for (let n = 0; n < steps; n++) {
    const control = input.take(C.STEP, steps - n);
    const before = { ...game.state.player };
    game.step(control, C.STEP);
    if (["playing", "wave"].includes(game.state.mode)) {
      for (const axis of ["x", "y"]) {
        const intended = Math.max(
          -C.PLAYER_MAX_STEP,
          Math.min(C.PLAYER_MAX_STEP, control["d" + axis]),
        );
        const actual = game.state.player[axis] - before[axis];
        if (Math.abs(intended - actual) > 1e-7) input.spin.stopAxis(axis);
      }
    }
    consumeEvents();
  }
  accumulator -= steps * C.STEP;
}
function updateHUD() {
  const s = game.state;
  const score = s.score || 0;
  if (score > best) {
    best = score;
    storage.set("high-score", best);
  }
  s.highScore = Math.max(best, s.highScore || 0);
  $("score").textContent = String(score).padStart(6, "0");
  $("high-score").textContent = String(best).padStart(6, "0");
  $("wave").textContent = String(s.wave || 1).padStart(2, "0");
  $("lives-icons").textContent = Array.from(
    { length: Math.min(s.lives ?? 3, C.MAX_LIVES) },
    () => "▴",
  ).join(" ");
  $("lives-label").textContent = `${s.lives ?? 3} TOOLS REMAINING`;
  const mode = s.mode;
  $("pause-button").disabled = ["title", "gameover"].includes(mode);
  const pauseLabel =
    mode === "paused" ? "RESUME <kbd>P</kbd>" : "PAUSE <kbd>P</kbd>";
  // Keep the pressed child attached between pointerdown and pointerup.
  if ($("pause-button").innerHTML !== pauseLabel)
    $("pause-button").innerHTML = pauseLabel;
  $("system-label").textContent =
    {
      title: "SYSTEM STANDBY",
      playing: "DRIVE ENGAGED",
      paused: "SYSTEM PAUSED",
      dying: "TOOL OFFLINE",
      wave: "NEXT CYCLE",
      gameover: "SYSTEM OFFLINE",
    }[mode] || "DRIVE ENGAGED";
  document.body.classList.toggle("playing", ["playing", "wave"].includes(mode));
  document.body.classList.toggle("paused", mode === "paused");
  const displayMode = mode === "paused" ? s.beforePause : mode;
  $("announcement").hidden = !["wave", "dying"].includes(displayMode);
  $("announcement").textContent =
    displayMode === "wave"
      ? `WAVE ${String(s.wave + 1).padStart(2, "0")}`
      : s.lives > 0
        ? "REPLACING TOOL"
        : "TOOL DESTROYED";
  if (mode === "gameover" && input.captured) {
    cancelCapture();
    document.exitPointerLock();
  }
  const overlayKey = mode + ":" + captureState + ":" + controlMode;
  if (shownMode === overlayKey) return;
  shownMode = overlayKey;
  $("start-btn").disabled = captureState === "requesting";
  syncCaptureUI();
  const visible = ["title", "paused", "gameover"].includes(mode);
  $("overlay").hidden = !visible;
  $("overlay").classList.toggle("compact", mode !== "title");
  $("overlay").classList.toggle("paused", mode === "paused");
  $("overlay").classList.toggle(
    "capture-notice",
    mode === "paused" && ["requesting", "blocked"].includes(captureState),
  );
  if (!visible) return;
  $("overlay-title").classList.toggle("game-name", mode === "title");
  if (mode === "title") {
    $("overlay-eyebrow").textContent = "THE MACHINE HAS GONE ROGUE";
    $("overlay-title").innerHTML = "MECHA<span>PEDE</span>";
    $("overlay-description").innerHTML =
      "Break the chain.<br>Keep the machine from breaking you.";
    $("start-btn").innerHTML = "ENGAGE DRIVE <span>↗</span>";
    $("start-hint").innerHTML =
      controlMode === "trackball"
        ? "<kbd>ENTER</kbd> captures motion · <kbd>ESC</kbd> releases"
        : "or press <kbd>ENTER</kbd>";
  } else if (
    mode === "paused" &&
    ["requesting", "blocked"].includes(captureState)
  ) {
    const blocked = captureState === "blocked";
    $("overlay-eyebrow").textContent = blocked
      ? "PAUSED · POINTER RELEASED"
      : "PAUSED · CONNECTING";
    $("overlay-description").innerHTML = blocked
      ? "Pointer capture was declined. Retry in an active Chrome window, or use window controls below."
      : "Your game stays frozen until pointer control is ready.";
    $("start-btn").innerHTML = blocked
      ? "RETRY <span>↗</span>"
      : "CONNECTING…";
    $("start-hint").textContent = blocked
      ? "Press Enter to retry"
      : "Escape cancels";
  } else if (mode === "paused") {
    $("overlay-eyebrow").textContent = "PAUSED · POINTER RELEASED";
    $("start-btn").innerHTML = "RESUME <span>↗</span>";
    $("start-hint").innerHTML = "<kbd>P</kbd> / <kbd>ENTER</kbd> to resume";
  } else {
    $("overlay-eyebrow").textContent =
      score >= best && score > 0
        ? "PERSONAL BEST RECORDED"
        : "ALL CUTTING TOOLS LOST";
    $("overlay-title").innerHTML = "DRIVE<br><span>OFFLINE</span>";
    $("overlay-description").innerHTML =
      `SCORE ${String(score).padStart(6, "0")} · WAVE ${s.wave}<br>The machine is ready for another round.`;
    $("start-btn").innerHTML = "RESTART DRIVE <span>↗</span>";
    $("start-hint").innerHTML =
      controlMode === "trackball"
        ? "<kbd>ENTER</kbd> captures motion · <kbd>ESC</kbd> releases"
        : "or press <kbd>ENTER</kbd>";
  }
}
function draw(delta) {
  consumeEvents();
  renderer.draw(game.state, delta);
  audio.update(game.state);
  updateHUD();
}
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!manual) simulate(dt);
  draw(manual ? 0 : dt);
  requestAnimationFrame(frame);
}
new ResizeObserver(() => {
  renderer.resize();
  input.clear();
  draw(0);
}).observe(canvas);
window.addEventListener("resize", () => {
  fitPlayfield();
  renderer.resize();
  input.clear();
  draw(0);
});
document.addEventListener("fullscreenchange", fitPlayfield);
window.render_game_to_text = () => {
  const s = game.state;
  return JSON.stringify({
    coordinates:
      "240×256 logical pixels; origin top-left, +x right, +y down. Tool centers: x4–236/y212–252.",
    mode: s.mode,
    score: s.score,
    highScore: s.highScore,
    lives: s.lives,
    wave: s.wave,
    time: s.time,
    frame: s.frame,
    player: s.player,
    bullet: s.bullet,
    gears: s.gears,
    sections: s.sections.map(
      ({ id, links, dir, vertical, poisoned, inPlayer, fast }) => ({
        id,
        links,
        dir,
        vertical,
        poisoned,
        inPlayer,
        fast,
      }),
    ),
    crawler: s.crawler,
    dispenser: s.dispenser,
    drone: s.drone,
    mainLength: s.mainLength,
    chainSpeed: s.chainSpeed,
    timers: s.timers,
    controls: {
      relativePointer: true,
      sensitivity: input.sensitivity,
      spin: { ...input.spin.velocity },
      captured: input.captured,
      mode: controlMode,
      captureState,
      captureError,
      held: [...input.keys],
      pointerFire: input.pointerFire,
    },
    audio: {
      activated: audio.context?.state === "running",
      muted: audio.muted,
      volume: audio.volume,
    },
  });
};
window.advanceTime = (ms) => {
  manual = true;
  simulate(Math.max(0, Number(ms) || 0) / 1000);
  draw(Math.max(0, Number(ms) || 0) / 1000);
};
window.__chainDrive = {
  game,
  input,
  audio,
  renderer,
  constants: C,
  pause,
  resume,
  draw: () => draw(0),
  setRealtime(value = true) {
    manual = !value;
    accumulator = 0;
    last = performance.now();
  },
  stepFrames(n = 1) {
    window.advanceTime(n * C.STEP * 1000);
  },
};
syncPrefs();
syncCaptureUI();
draw(0);
requestAnimationFrame(frame);
