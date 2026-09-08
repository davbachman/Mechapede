// Relative movement only: absolute pointer position never sets the tool position.
import { TrackballMotion } from "./trackball-motion.js";

export class Controls {
  constructor(canvas, { getMode, onAction, sensitivity = 1.5 } = {}) {
    this.canvas = canvas;
    this.getMode = getMode;
    this.onAction = onAction;
    this.sensitivity = sensitivity;
    this.spin = new TrackballMotion();
    this.keys = new Set();
    this.pointerFire = false;
    this.dx = 0;
    this.dy = 0;
    this.last = null;
    this.wasLocked = document.pointerLockElement === canvas;
    // Locked movement is specified on MouseEvent. Listen on the document, so
    // trackball deltas also work in browsers that omit locked pointermove events.
    document.addEventListener("mousemove", (e) => this.move(e));
    document.addEventListener("mouseover", (e) => {
      if (!e.relatedTarget && !this.captured) this.last = null;
    });
    document.addEventListener("mouseout", (e) => {
      if (!e.relatedTarget && !this.captured) {
        this.clear();
        if (this.active) this.onAction("pointer-exit");
      }
    });
    document.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.isSetting(e.target)) return;
      if (!this.active) return;
      // Canceling pointerdown suppresses compatibility mousemove while firing in
      // some browsers. CSS user-select:none prevents selection during play.
      canvas.focus({ preventScroll: true });
      this.last = { x: e.clientX, y: e.clientY };
      this.pointerFire = true;
      this.onAction("audio");
    });
    window.addEventListener("pointerup", (e) => {
      if (e.button === 0) this.pointerFire = false;
    });
    window.addEventListener("pointercancel", () => this.clear());
    window.addEventListener("keydown", (e) => this.keydown(e));
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "Space" && !this.isSetting(e.target)) e.preventDefault();
    });
    window.addEventListener("blur", () => {
      this.clear();
      this.onAction("blur");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.clear();
        this.onAction("blur");
      }
    });
    document.addEventListener("pointerlockchange", () => {
      const captured = this.captured;
      const released = this.wasLocked && !captured;
      this.wasLocked = captured;
      this.dx = this.dy = 0;
      this.last = null;
      this.spin.clear();
      if (captured) this.onAction("capture-enter");
      else if (released) {
        this.clear();
        this.onAction("capture-exit");
      }
    });
    document.addEventListener("pointerlockerror", () =>
      this.onAction("capture-error"),
    );
  }
  get active() {
    return ["playing", "wave"].includes(this.getMode());
  }
  get captured() {
    return document.pointerLockElement === this.canvas;
  }
  isSetting(target) {
    return target?.closest?.("input,select,textarea,button,a");
  }
  keydown(e) {
    const actions = {
      Enter: "start",
      KeyP: "pause",
      Escape: "escape",
      KeyM: "mute",
      KeyF: "fullscreen",
    };
    if (actions[e.code] && !(e.code === "Enter" && this.isSetting(e.target))) {
      e.preventDefault();
      if (!e.repeat) this.onAction(actions[e.code]);
      return;
    }
    if (this.isSetting(e.target)) return;
    if (
      [
        "Space",
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ].includes(e.code)
    ) {
      e.preventDefault();
      if (this.active) {
        if (e.code !== "Space") this.spin.clear();
        this.keys.add(e.code);
        if (e.code === "Space") this.onAction("audio");
      }
    }
  }
  move(e) {
    const rect = this.canvas.getBoundingClientRect();
    let dx = 0,
      dy = 0;
    if (this.captured) {
      dx = Number.isFinite(e.movementX) ? e.movementX : 0;
      dy = Number.isFinite(e.movementY) ? e.movementY : 0;
    } else {
      if (this.last) {
        dx = e.clientX - this.last.x;
        dy = e.clientY - this.last.y;
      }
      this.last = { x: e.clientX, y: e.clientY };
    }
    if (!this.active) return;
    // Direct positioning stays immediate. Gesture speed spins the virtual ball;
    // conversion uses CSS size, so display pixel density does not change control.
    const logicalX = (dx * 240) / rect.width;
    const logicalY = (dy * 256) / rect.height;
    if (!Number.isFinite(logicalX) || !Number.isFinite(logicalY)) return;
    this.spin.sample(logicalX, logicalY, e.timeStamp, this.sensitivity);
    this.dx += logicalX * this.sensitivity;
    this.dy += logicalY * this.sensitivity;
  }
  take(dt, remainingSteps = 1) {
    if (!this.active) {
      this.clear();
      return { dx: 0, dy: 0, fire: false };
    }
    const x =
      (this.keys.has("ArrowRight") || this.keys.has("KeyD") ? 1 : 0) -
      (this.keys.has("ArrowLeft") || this.keys.has("KeyA") ? 1 : 0);
    const y =
      (this.keys.has("ArrowDown") || this.keys.has("KeyS") ? 1 : 0) -
      (this.keys.has("ArrowUp") || this.keys.has("KeyW") ? 1 : 0);
    // Spread only fresh hand displacement across catch-up ticks. Integrating
    // friction per simulation tick preserves the engine's movement cap at any FPS.
    const directX = this.dx / remainingSteps;
    const directY = this.dy / remainingSteps;
    this.dx -= directX;
    this.dy -= directY;
    if (x || y) this.spin.clear();
    const coast = this.spin.step(dt, !!(directX || directY));
    return {
      dx: directX + coast.dx + x * 180 * dt,
      dy: directY + coast.dy + y * 180 * dt,
      fire: this.pointerFire || this.keys.has("Space"),
    };
  }
  clear() {
    this.keys.clear();
    this.pointerFire = false;
    this.dx = 0;
    this.dy = 0;
    this.last = null;
    this.spin.clear();
  }
}
