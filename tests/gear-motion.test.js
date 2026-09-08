import test from "node:test";
import assert from "node:assert/strict";
import { GearMotion } from "../src/gear-motion.js";
import { Game } from "../src/game.js";

const TOUCH_Y = (3.85 + 2.2) * 0.8;

function rig({ y = TOUCH_Y, xs = [-8, 0, 8] } = {}) {
  const gear = { id: 1, x: 0, y: 0, hp: 4, contact: 0 };
  const links = xs.map((x, id) => ({ id: id + 2, x, y }));
  const state = {
    mode: "playing",
    time: 0,
    frame: 0,
    gears: [gear],
    sections: [{ id: 20, links }],
  };
  const motion = new GearMotion();
  motion.update(state);
  return {
    state,
    gear,
    links,
    motion,
    move(dx, dy = 0) {
      for (const link of links) {
        link.x += dx;
        link.y += dy;
      }
      state.frame++;
      state.time += 1 / 60;
      motion.update(state);
    },
  };
}

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-10);

test("a passing tread drives the gear by tangential travel at its pitch radius", () => {
  const { move, gear, motion } = rig();
  move(1);
  close(motion.angle(gear), -1 / 3.4);
  close(motion.contact(gear).x, 0);
  close(motion.contact(gear).y, 3.85 * 0.8);
  close(motion.contact(gear).travel, -1);
  move(-1);
  close(motion.angle(gear), 0);
});

test("the opposite side of the same gear reverses its rotation", () => {
  const { move, gear, motion } = rig({ y: -TOUCH_Y });
  move(1);
  close(motion.angle(gear), 1 / 3.4);
});

test("followers keep a gear turning after the head has moved past it", () => {
  const { move, gear, motion, links } = rig({ xs: [24, 16, 8, 0, -8, -16] });
  assert.ok(Math.hypot(links[0].x, links[0].y) > 8.8);
  let drivenFrames = 0;
  for (let n = 0; n < 16; n++) {
    const before = motion.angle(gear);
    move(1);
    if (motion.angle(gear) < before) drivenFrames++;
  }
  assert.ok(drivenFrames >= 12, `${drivenFrames} follower contact frames`);
});

test("redraws, a stopped chain, pause and the end of contact preserve orientation", () => {
  const { move, state, gear, motion } = rig();
  move(0.25);
  const angle = motion.angle(gear);
  for (let n = 0; n < 4; n++) motion.update(state);
  move(0);
  close(motion.angle(gear), angle);
  state.mode = "paused";
  move(1);
  close(motion.angle(gear), angle);
  state.mode = "playing";
  move(0, 12);
  assert.equal(motion.contact(gear), null);
  close(motion.angle(gear), angle);
});

test("approaching a gear radially does not make it spin", () => {
  const { move, gear, motion } = rig({ y: 0, xs: [-8] });
  move(1);
  assert.ok(motion.contact(gear));
  close(motion.angle(gear), 0);
});

test("different render frequencies produce the same rotation during continuous contact", () => {
  const fine = rig();
  const coarse = rig();
  for (let n = 0; n < 8; n++) fine.move(0.2);
  coarse.move(1.6);
  close(fine.motion.angle(fine.gear), coarse.motion.angle(coarse.gear));
});

test("drawbars and separate sections cannot drive gears across a gap between treads", () => {
  const { state, links, gear, motion, move } = rig({ xs: [-6, 6] });
  move(1);
  assert.equal(motion.contact(gear), null);
  close(motion.angle(gear), 0);
  state.sections = links.map((link, id) => ({ id: id + 20, links: [link] }));
  move(-1);
  assert.equal(motion.contact(gear), null);
  close(motion.angle(gear), 0);
});

test("removed gears, a new game, and a rewound clock do not inherit old spin", () => {
  const { state, gear, motion, move } = rig();
  move(1);
  assert.notEqual(motion.angle(gear), 0);
  state.gears = [];
  motion.update(state);
  close(motion.angle(gear), 0);
  state.gears = [gear];
  move(1);
  assert.notEqual(motion.angle(gear), 0);
  state.frame = 0;
  state.time = 0;
  motion.update(state);
  close(motion.angle(gear), 0);
  move(1);
  motion.update(structuredClone(state));
  close(motion.angle(gear), 0);
});

test("teleported links do not impart a spurious turn", () => {
  const { gear, links, state, motion } = rig({ xs: [-100] });
  links[0].x = 0;
  state.frame++;
  motion.update(state);
  assert.ok(motion.contact(gear));
  close(motion.angle(gear), 0);
});

test("real obstacle turns drive gears without changing any authoritative state", () => {
  const game = new Game({ seed: 123 });
  game.start();
  game.debug("clear");
  game.debug("section", { count: 6, x: 124, y: 84, dir: 1 });
  const gear = game.debug("gear", { col: 16, row: 10 });
  const motion = new GearMotion();
  let drivenFrames = 0;
  for (let n = 0; n < 60; n++) {
    const before = game.inspect();
    motion.update(game.state);
    assert.deepEqual(game.inspect(), before);
    if (Math.abs(motion.contact(gear)?.travel ?? 0) > 0.01) drivenFrames++;
    game.step();
  }
  assert.ok(drivenFrames >= 6, `${drivenFrames} frames of gear engagement`);
  assert.notEqual(motion.angle(gear), 0);
});

test("a natural turn drives gears only when a tread reaches the teeth", () => {
  const game = new Game({ seed: 123 });
  game.start();
  game.debug("clear");
  game.debug("section", { count: 6, x: 100, y: 84, dir: 1 });
  const gear = game.debug("gear", { col: 16, row: 10 });
  const motion = new GearMotion({ toothRadius: 4.2 });
  let drivenFrames = 0;
  for (let n = 0; n < 80; n++) {
    motion.update(game.state);
    if ([11, 15, 19, 21, 23, 27, 29].includes(n))
      assert.equal(motion.contact(gear), null, `visible gap at frame ${n}`);
    if ([12, 16, 20, 24, 28].includes(n))
      assert.ok(motion.contact(gear), `tooth contact at frame ${n}`);
    if (Math.abs(motion.contact(gear)?.travel ?? 0) > 0.01) drivenFrames++;
    game.step();
  }
  assert.ok(drivenFrames >= 6, `${drivenFrames} frames of tread engagement`);
  assert.ok(Math.abs(motion.angle(gear)) > 0.5);
});

test("the contact margin cannot reach treads more than 0.35 screen units away", () => {
  const { gear, motion, move } = rig({ y: TOUCH_Y + 0.36 * 0.8 });
  for (let n = 0; n < 8; n++) move(1);
  assert.equal(motion.contact(gear), null);
  close(motion.angle(gear), 0);
});

test("vertical tread contact and movement use the displayed pixel aspect", () => {
  const { links, state, gear, motion, move } = rig({ y: 0, xs: [3.85 + 2.2] });
  links[0].angle = Math.PI / 2;
  motion.reset();
  motion.update(state);
  move(0, 1);
  close(motion.contact(gear).x, 3.85);
  close(motion.contact(gear).y, 0);
  close(motion.contact(gear).travel, 1 / 0.8);
  close(motion.angle(gear), 1 / 0.8 / 3.4);
});

test("resizing updates contact geometry without creating motion", () => {
  const { state, gear, motion } = rig({ y: 3.85 + 2.2, xs: [0] });
  assert.equal(motion.contact(gear), null);
  motion.pixelAspectY = 1;
  motion.update(state);
  assert.ok(motion.contact(gear));
  close(motion.angle(gear), 0);
});

test("a tread crossing a mounted gear's hub is not tooth engagement", () => {
  const { gear, motion, move } = rig({ y: 0, xs: [0] });
  move(1);
  assert.equal(motion.contact(gear), null);
  close(motion.angle(gear), 0);
});
