import test from "node:test";
import assert from "node:assert/strict";
import { chainPoses } from "../src/chain-pose.js";
import { TreadMotion } from "../src/tread-motion.js";
import { GearMotion } from "../src/gear-motion.js";
import { Renderer } from "../src/render.js";
import { wrapX, wrappedDelta } from "../src/topology.js";

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test("cylinder articulation follows the shallow slope across either seam", () => {
  for (const dir of [-1, 1]) {
    const angle = Math.atan2(1 / 30, dir);
    const section = {
      links: [0, 1, 2].map((i) => ({
        id: i,
        x: wrapX(dir * (2 - 8 * i)),
        y: 80 - (8 * i) / 30,
        angle,
      })),
    };
    const before = structuredClone(section);
    for (const pose of chainPoses(section, [], "cylinder"))
      close(pose.angle, angle);
    assert.deepEqual(section, before);
  }
});

test("turn seating reaches the same gear across the seam without moving simulation centers", () => {
  const section = {
    links: [{ id: 1, x: 239, y: 80, turning: { progress: 4 } }],
  };
  const before = structuredClone(section);
  const cylinder = chainPoses(section, [{ x: 4, y: 84 }], "cylinder")[0];
  const planar = chainPoses(section, [{ x: 244, y: 84 }])[0];
  close(wrappedDelta(cylinder.x - planar.x), 0);
  close(cylinder.y, planar.y);
  assert.deepEqual(section, before);
});

test("treads roll through either seam and pause without phase jumps", () => {
  for (const dir of [-1, 1]) {
    const link = {
      id: 1,
      x: dir > 0 ? 239 : 1,
      y: 80,
      angle: Math.atan2(1 / 30, dir),
    };
    const state = {
      variant: "cylinder",
      mode: "playing",
      frame: 0,
      time: 0,
      sections: [{ links: [link] }],
    };
    const motion = new TreadMotion();
    motion.update(state);
    for (let i = 1; i <= 5; i++) {
      link.x = wrapX(link.x + 2 * dir);
      link.y += 2 / 30;
      state.frame++;
      state.time += 1 / 60;
      motion.update(state);
      close(motion.travel(link), i * Math.hypot(2, 2 / 30 / 0.8));
    }
    const phase = motion.travel(link);
    motion.update(state);
    close(motion.travel(link), phase);
    state.mode = "paused";
    motion.update(state);
    close(motion.travel(link), phase);
  }
});

test("a tread drives a gear identically across the seam and in the middle of a flat board", () => {
  const gear = { id: 1, x: 240, y: 80 };
  const link = { id: 2, x: 238, y: 80 + (3.85 + 2.2) * 0.8, angle: 0 };
  const flat = {
    mode: "playing",
    frame: 0,
    time: 0,
    gears: [gear],
    sections: [{ links: [link] }],
  };
  const cylinder = structuredClone(flat);
  cylinder.variant = "cylinder";
  cylinder.gears[0].x = 0;
  const planarMotion = new GearMotion();
  const wrappedMotion = new GearMotion();
  for (let i = 0; i <= 8; i++) {
    link.x = 238 + i * 0.5;
    cylinder.sections[0].links[0].x = wrapX(link.x);
    flat.frame = cylinder.frame = i;
    flat.time = cylinder.time = i / 60;
    planarMotion.update(flat);
    wrappedMotion.update(cylinder);
    close(wrappedMotion.angle(cylinder.gears[0]), planarMotion.angle(gear));
    close(
      wrappedMotion.contact(cylinder.gears[0]).travel,
      planarMotion.contact(gear).travel,
    );
  }
  assert.ok(Math.abs(wrappedMotion.angle(cylinder.gears[0])) > 1);
});

function drawingRig(cylinder = true) {
  let offset = 0;
  let point;
  const stack = [];
  const segments = [];
  const units = [];
  const c = {
    save: () => stack.push(offset),
    restore: () => {
      offset = stack.pop();
    },
    translate: (x) => {
      offset += x;
    },
    beginPath() {},
    moveTo: (x, y) => {
      point = { x: x + offset, y };
    },
    lineTo: (x, y) => segments.push([point, { x: x + offset, y }]),
    stroke() {},
  };
  const renderer = {
    c,
    cylinder,
    wrapDraw: Renderer.prototype.wrapDraw,
    trackedUnit: (link) => units.push({ x: link.x + offset, y: link.y }),
  };
  return { renderer, segments, units, offset: () => offset };
}

test("seam drawbars are short continuations on both edges, with no line through the board", () => {
  const r = drawingRig();
  const section = {
    links: [
      { id: 1, x: 2, y: 80 + 4 / 30, angle: Math.atan(1 / 30) },
      { id: 2, x: 234, y: 80 - 4 / 30, angle: Math.atan(1 / 30) },
    ],
  };
  Renderer.prototype.chain.call(r.renderer, section, 0);
  assert.equal(r.segments.length, 6);
  for (const [a, b] of r.segments) {
    close(Math.abs(a.x - b.x), 8);
    assert.ok(Math.max(a.x, b.x) < 10 || Math.min(a.x, b.x) > 230);
  }
  assert.deepEqual(
    r.units.map((unit) => unit.x),
    [234, 2, 242],
  );
  close(r.offset(), 0);
});

test("edge copies share one height and remain disabled for Classic or initial enemy ingress", () => {
  const r = drawingRig();
  let centers = [];
  r.renderer.wrapDraw(239, 5, () => centers.push(239 + r.offset()));
  assert.deepEqual(centers, [239, -1]);
  centers = [];
  r.renderer.wrapDraw(-3, 5, () => centers.push(-3 + r.offset()), false);
  assert.deepEqual(centers, [-3]);
  centers = [];
  r.renderer.cylinder = false;
  r.renderer.wrapDraw(239, 5, () => centers.push(239 + r.offset()));
  assert.deepEqual(centers, [239]);
});
