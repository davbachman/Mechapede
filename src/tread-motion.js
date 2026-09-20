import { wrappedDelta } from "./topology.js";

const MAX_SAMPLE_TRAVEL = 16;

/** Wheel and tread animation follows the simulation's displacement, not the
 * redraw clock. Distances use the same round-pixel space as the belt artwork. */
export class TreadMotion {
  constructor({ pixelAspectY = 0.8 } = {}) {
    this.pixelAspectY = pixelAspectY;
    this.reset();
  }

  reset() {
    this.links = new Map();
    this.state = null;
    this.frame = -1;
    this.time = -1;
  }

  travel(link) {
    return this.links.get(link.id ?? link)?.travel ?? 0;
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

    const nextLinks = new Map();
    for (const section of state.sections ?? []) {
      for (const link of section.links ?? []) {
        const key = link.id ?? link;
        const before = this.links.get(key);
        let travel = before?.travel ?? 0;
        if (before && state.mode === "playing") {
          const dx =
            state.variant === "cylinder"
              ? wrappedDelta(link.x - before.x)
              : link.x - before.x;
          const dy = link.y - before.y;
          // A reset or debug jump must not wind the tread through the gap.
          if (Math.hypot(dx, dy) <= MAX_SAMPLE_TRAVEL) {
            const screenDy = dy / this.pixelAspectY;
            const heading =
              link.angle ?? ((link.dir ?? section.dir ?? 1) > 0 ? 0 : Math.PI);
            const forward =
              dx * Math.cos(heading) +
              screenDy * (Math.sin(heading) / this.pixelAspectY);
            travel += Math.sign(forward) * Math.hypot(dx, screenDy);
          }
        }
        // Still sample during pause/title so resuming never catches up movement
        // that happened while animation was frozen. Stable IDs retain phase
        // when a link becomes the head of a newly split section.
        nextLinks.set(key, { x: link.x, y: link.y, travel });
      }
    }
    this.links = nextLinks;
  }
}
