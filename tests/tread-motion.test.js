import test from "node:test";
import assert from "node:assert/strict";
import { TreadMotion } from "../src/tread-motion.js";
import { Game } from "../src/game.js";

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

function rig({ angle = 0, dir = 1, pixelAspectY = 0.8 } = {}) {
  const link = { id: 2, x: 40, y: 40, angle, dir };
  const state = {
    mode: "playing",
    time: 0,
    frame: 0,
    sections: [{ id: 1, dir, links: [link] }],
  };
  const motion = new TreadMotion({ pixelAspectY });
  motion.update(state);
  return {
    link,
    state,
    motion,
    move(dx, dy = 0) {
      link.x += dx;
      link.y += dy;
      state.frame++;
      state.time += 1 / 60;
      motion.update(state);
    },
  };
}

test("tread travel uses actual displacement and the displayed pixel aspect", () => {
  const r = rig();
  r.move(3);
  close(r.motion.travel(r.link), 3);
  r.link.angle = Math.PI / 2;
  r.move(0, 4);
  close(r.motion.travel(r.link), 8);
  r.motion.pixelAspectY = 1;
  r.move(0, 4);
  close(r.motion.travel(r.link), 12);
});

test("turning the unit keeps forward tread travel positive; backing up reverses it", () => {
  const r = rig();
  r.move(2);
  r.link.angle = Math.PI / 4;
  r.move(2, 2);
  const corner = 2 + Math.hypot(2, 2 / 0.8);
  close(r.motion.travel(r.link), corner);
  r.link.angle = Math.PI;
  r.link.dir = -1;
  r.move(-3);
  close(r.motion.travel(r.link), corner + 3);
  r.move(1);
  close(r.motion.travel(r.link), corner + 2);
});

test("direction supplies the heading for links without an angle", () => {
  const r = rig({ dir: -1 });
  delete r.link.angle;
  r.move(-3);
  close(r.motion.travel(r.link), 3);
});

test("straight travel is independent of how often frames are rendered", () => {
  for (const angle of [0, Math.PI, Math.PI / 4, Math.PI / 2]) {
    const fine = rig({ angle });
    const coarse = rig({ angle });
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    for (let i = 0; i < 8; i++) fine.move(dx, dy);
    coarse.move(dx * 8, dy * 8);
    close(fine.motion.travel(fine.link), coarse.motion.travel(coarse.link));
  }
});

test("redraws, stopped units, pause and title preserve the tread phase", () => {
  const r = rig();
  r.move(2);
  for (let i = 0; i < 5; i++) r.motion.update(r.state);
  r.move(0);
  close(r.motion.travel(r.link), 2);
  for (const mode of ["paused", "title"]) {
    r.state.mode = mode;
    r.move(4);
    close(r.motion.travel(r.link), 2);
  }
  r.state.mode = "playing";
  r.motion.update(r.state);
  close(r.motion.travel(r.link), 2);
  r.move(1);
  close(r.motion.travel(r.link), 3);
});

test("split and promoted links preserve their own accumulated tread phases", () => {
  const r = rig();
  const follower = { id: 3, x: 32, y: 40, angle: 0 };
  r.state.sections[0].links.push(follower);
  r.motion.update(r.state);
  follower.x += 3;
  r.move(2);
  const promoted = { ...follower, leader: true, isHead: true };
  r.state.sections = [
    { id: 1, links: [r.link] },
    { id: 4, links: [promoted] },
  ];
  r.motion.update(r.state);
  close(r.motion.travel(promoted), 3);
  close(r.motion.travel(r.link), 2);
  promoted.x += 1;
  r.move(1);
  close(r.motion.travel(promoted), 4);
  close(r.motion.travel(r.link), 3);
});

test("teleports rebase the position without turning the wheels", () => {
  const r = rig();
  r.move(2);
  r.move(80, 40);
  close(r.motion.travel(r.link), 2);
  r.move(1);
  close(r.motion.travel(r.link), 3);
});

test("new games, rewound clocks and removed links do not inherit old phases", () => {
  const r = rig();
  r.move(2);
  r.state.frame = 0;
  r.state.time = 0;
  r.motion.update(r.state);
  close(r.motion.travel(r.link), 0);
  r.move(2);
  r.motion.update(structuredClone(r.state));
  close(r.motion.travel(r.link), 0);
  r.motion.update(r.state);
  r.move(2);
  r.state.sections = [];
  r.motion.update(r.state);
  close(r.motion.travel(r.link), 0);
  r.motion.reset();
  assert.equal(r.motion.links.size, 0);
});

test("real obstacle turns advance each surviving tread without changing the game", () => {
  const game = new Game({ seed: 123 });
  game.start();
  game.debug("clear");
  const section = game.debug("section", { count: 6, x: 100, y: 84, dir: 1 });
  game.debug("gear", { col: 16, row: 10 });
  const motion = new TreadMotion();
  const phases = new Map();
  let turningSamples = 0;
  for (let n = 0; n < 60; n++) {
    const before = game.inspect();
    motion.update(game.state);
    assert.deepEqual(game.inspect(), before);
    for (const link of section.links) {
      const previous = phases.get(link.id) ?? 0;
      assert.ok(motion.travel(link) >= previous);
      if (link.turning && motion.travel(link) > previous) turningSamples++;
      phases.set(link.id, motion.travel(link));
    }
    game.step();
  }
  assert.ok(turningSamples > 10, `${turningSamples} moving turn samples`);
  assert.ok([...phases.values()].every((travel) => travel > 40));
});
