import { chainPoses } from "./chain-pose.js";

const TAU = Math.PI * 2;
const MAX_SAMPLE_TRAVEL = 16;
const TRACK_HALF_STRAIGHT = 1.7;
const TRACK_OUTER_RADIUS = 2.2;
const CONTACT_GAP = 0.35;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Visual coupling only: the arcade simulation owns every position and collision.
 * Sample actual displacement, rather than render time, so a stopped tread cannot
 * drive a gear and drawing the same frame twice cannot advance its rotation. */
export class GearMotion {
  constructor({
    pitchRadius = 3.4,
    toothRadius = 3.85,
    pixelAspectY = 0.8,
  } = {}) {
    this.pitchRadius = pitchRadius;
    this.toothRadius = toothRadius;
    this.pixelAspectY = pixelAspectY;
    this.reset();
  }

  reset() {
    this.gears = new Map();
    this.links = new Map();
    this.state = null;
    this.frame = -1;
    this.time = -1;
  }

  angle(gear) {
    return this.gears.get(gear.id ?? gear)?.angle ?? 0;
  }

  /** Current tooth-edge contact, in logical coordinates; travel is the signed
   * tangential displacement since the previous update, not an ongoing velocity. */
  contact(gear) {
    return this.gears.get(gear.id ?? gear)?.contact ?? null;
  }

  update(state) {
    if (
      (this.state && this.state !== state) ||
      state.frame < this.frame ||
      state.time < this.time
    )
      this.reset();
    this.state = state;
    this.frame = state.frame;
    this.time = state.time;

    const capsules = [];
    const nextLinks = new Map();
    for (const section of state.sections ?? []) {
      const posedLinks = chainPoses(section, state.gears ?? []);
      for (const link of posedLinks) {
        const key = link.id ?? link;
        const before = this.links.get(key);
        const dx = before ? link.x - before.x : 0;
        const dy = before ? link.y - before.y : 0;
        // Life resets, debug jumps and long gaps must not wind a nearby gear.
        const continuous = before && Math.hypot(dx, dy) <= MAX_SAMPLE_TRAVEL;
        const angle = Math.atan2(
          Math.sin(link.angle || 0) / this.pixelAspectY,
          Math.cos(link.angle || 0),
        );
        capsules.push({
          x: link.x,
          y: link.y / this.pixelAspectY,
          ux: Math.cos(angle),
          uy: Math.sin(angle),
          dx: continuous ? dx : 0,
          dy: continuous ? dy / this.pixelAspectY : 0,
        });
        nextLinks.set(key, { x: link.x, y: link.y });
      }
    }
    this.links = nextLinks;

    const nextGears = new Map();
    for (const gear of state.gears ?? []) {
      const key = gear.id ?? gear;
      let wheel = this.gears.get(key);
      if (!wheel || wheel.x !== gear.x || wheel.y !== gear.y)
        wheel = { x: gear.x, y: gear.y, angle: 0, contact: null };
      wheel.contact = null;

      let closest = null;
      // Test each complete tread in the same round-pixel space used by its
      // artwork. A drawbar between units is not a belt and cannot drive a gear.
      for (const { x, y, ux, uy, dx, dy } of capsules) {
        const gx = gear.x - x;
        const gy = gear.y / this.pixelAspectY - y;
        const along = clamp(
          gx * ux + gy * uy,
          -TRACK_HALF_STRAIGHT,
          TRACK_HALF_STRAIGHT,
        );
        const rx = along * ux - gx;
        const ry = along * uy - gy;
        const distance = Math.hypot(rx, ry);
        const gap = distance - TRACK_OUTER_RADIUS - this.toothRadius;
        // Treads may seat between the teeth, but never through the solid hub.
        if (gap > CONTACT_GAP || gap < -this.toothRadius * 0.22) continue;
        if (closest && distance >= closest.distance) continue;
        closest = { rx, ry, distance, gap, dx, dy };
      }

      if (closest) {
        const { rx, ry, distance, dx, dy, gap } = closest;
        const travel =
          state.mode === "playing" ? (rx * dy - ry * dx) / distance : 0;
        wheel.angle = (wheel.angle + travel / this.pitchRadius) % TAU;
        wheel.contact = {
          x: gear.x + (rx / distance) * this.toothRadius,
          y: gear.y + (ry / distance) * this.toothRadius * this.pixelAspectY,
          strength: clamp(1 - gap / CONTACT_GAP, 0, 1),
          travel,
        };
      }
      nextGears.set(key, wheel);
    }
    this.gears = nextGears;
  }
}
