import test from "node:test";
import assert from "node:assert/strict";
import { Game, C } from "../src/game.js";
import { pistonTouches } from "../src/gantry.js";
import { ROUND_Y, sweepCircle } from "../src/round-hazards.js";

function lab() {
  const g = new Game({ seed: 321 });
  g.start(); g.debug("clear");
  g.debug("section", { count: 1, x: 30, y: 36 });
  g.state.player = { x: 200, y: 252 };
  return { g, s: g.state };
}
const frames = (fn, n) => { for (let i = 0; i < n; i++) fn(); };
const close = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const gantry = (g, props = {}) => g.debug("enemy", {
  type: "gantry", x: 100, entered: true, phase: "warning", age: 0, ...props,
});
const wheel = (g, props = {}) => g.debug("enemy", {
  type: "flywheel", x: 100, y: 60, vx: 60, vy: 0, ...props,
});

test("Classic and the retired enemies cannot be selected or spawned", () => {
  const g = new Game({ variant: "classic" });
  g.start();
  assert.equal(g.state.variant, "cylinder");
  assert.equal(g.setVariant, undefined);
  for (const type of ["crawler", "spider", "drone"]) {
    assert.equal(g.debug("enemy", { type }), null);
    assert.equal(type in g.state, false);
  }
});

test("gantry spawns after its delay on a rail above the entire player region", () => {
  const { g, s } = lab();
  s.timers.gantry = C.GANTRY_SPAWN;
  frames(() => g._moveGantry(), 209);
  assert.equal(s.gantry, null);
  frames(() => g._moveGantry(), 2);
  assert.equal(s.gantry.y, C.GANTRY_Y);
  assert.ok(s.gantry.y + 4 < C.PLAYER_MIN_Y);
  assert.equal(s.gantry.hp, 3);
});

test("gantry warning locks its column and stays harmless for the full warning interval", () => {
  const { g } = lab();
  const e = gantry(g);
  frames(() => g._moveGantry(), 50);
  assert.equal(e.phase, "warning");
  assert.equal(e.x, 100);
  assert.equal(e.extension, 0);
  assert.equal(pistonTouches(e, 100, 252, 3.8, 3.5), false);
  g._moveGantry();
  assert.equal(e.phase, "extend");
  assert.equal(e.extension, 0);
  g._moveGantry();
  assert.ok(e.extension > 0);
});

test("gantry reaches the bottom, retracts completely, then resumes travel", () => {
  const { g } = lab();
  const e = gantry(g, { phase: "extend" });
  frames(() => g._moveGantry(), 12);
  assert.equal(e.phase, "hold");
  assert.equal(e.extension, C.GANTRY_REACH);
  assert.equal(pistonTouches(e, 100, 252, 3.8, 3.5), true);
  assert.equal(pistonTouches(e, 112, 252, 3.8, 3.5), false);
  frames(() => g._moveGantry(), 18);
  assert.equal(e.phase, "retract");
  frames(() => g._moveGantry(), 28);
  assert.equal(e.phase, "recover");
  assert.equal(e.extension, 0);
  frames(() => g._moveGantry(), 54);
  assert.equal(e.phase, "travel");
  g._moveGantry();
  assert.ok(e.x > 100);
});

test("extended shaft and wider foot use different collision widths, including across the seam", () => {
  const { g } = lab();
  const e = gantry(g, { x: 1, phase: "hold", extension: 45 });
  assert.equal(pistonTouches(e, 239, 225, 3.8, 3.5), true);
  assert.equal(pistonTouches(e, 234, 225, 3.8, 3.5), false);
  assert.equal(pistonTouches(e, 234, 252, 3.8, 3.5), true);
  e.phase = "retract";
  assert.equal(pistonTouches(e, 1, 252, 3.8, 3.5), true);
  e.extension = 0;
  assert.equal(pistonTouches(e, 1, 225, 3.8, 3.5), false);
});

test("gantry shots interrupt both a warning and an extended piston, with three hits worth 600", () => {
  const { g, s } = lab();
  const e = gantry(g);
  s.bullet = { x: 100, y: 212 }; g._moveBullet();
  assert.equal(e.hp, 2);
  assert.equal(e.phase, "recover");
  Object.assign(e, { phase: "hold", extension: 32 });
  s.bullet = { x: 105, y: 242 }; g._moveBullet();
  assert.equal(e.hp, 1);
  assert.equal(e.phase, "retract");
  assert.equal(s.score, 0);
  s.bullet = { x: 100, y: 232 }; g._moveBullet();
  assert.equal(s.gantry, null);
  assert.equal(s.score, 600);
  close(s.timers.gantry, C.GANTRY_RESPAWN);
});

test("gantry crushes gears in its stroke without granting score or touching adjacent lanes", () => {
  const { g, s } = lab();
  gantry(g, { phase: "extend" });
  const crushed = g.debug("gear", { col: 12, row: 27 });
  const safe = g.debug("gear", { col: 15, row: 27 });
  frames(() => g._moveGantry(), 12);
  assert.ok(!s.gears.includes(crushed));
  assert.ok(s.gears.includes(safe));
  assert.equal(s.score, 0);
});

test("gantry enters only on its original edge and wraps only after arrival", () => {
  const { g } = lab();
  const e = gantry(g, { x: -8, entered: false, phase: "travel", dir: 1 });
  g._moveGantry();
  close(e.x, -6.6);
  assert.equal(e.entered, false);
  frames(() => g._moveGantry(), 5);
  assert.equal(e.entered, true);
  Object.assign(e, { x: 239, dir: 1, age: 0 });
  g._moveGantry();
  close(e.x, 0.4);
});

test("flywheel enters diagonally from above, independently of the parts dispenser", () => {
  const { g, s } = lab();
  g.debug("enemy", { type: "dispenser", x: 60, y: 50 });
  s.timers.flywheel = C.STEP;
  g._moveFlywheel();
  assert.ok(s.flywheel.y < 0);
  assert.ok(Math.abs(s.flywheel.vx) >= 45);
  assert.ok(s.flywheel.vy > 0);
  assert.ok(s.dispenser);
  assert.equal(s.fallingGears.length, 0);
});

test("unobstructed flywheel follows a gravitational parabola, including a rising arc", () => {
  const { g } = lab();
  const e = wheel(g, { vy: -30 });
  frames(() => g._moveFlywheel(), 30);
  close(e.x, 130);
  close(e.vy, -30 + C.FLYWHEEL_GRAVITY * 0.5);
  close(e.y, 60 - 30 * 0.5 + C.FLYWHEEL_GRAVITY * C.STEP ** 2 * 30 * 31 / 2);
  assert.ok(e.vy > 0, "gravity turns the upward arc downward");
});

test("top impact rebounds upward and detaches exactly the contacted gear; gravity brings it down again", () => {
  const { g, s } = lab();
  const gear = g.debug("gear", { col: 12, row: 12, hp: 2 });
  const e = wheel(g, { x: gear.x, y: gear.y - 10, vx: 0, vy: 100 });
  g._moveFlywheel();
  assert.ok(e.vy < 0, `top rebound vy ${e.vy}`);
  close(e.vy, -(100 + C.FLYWHEEL_GRAVITY * C.STEP) * C.FLYWHEEL_RESTITUTION);
  assert.equal(s.gears.length, 0);
  assert.equal(s.fallingGears.length, 1);
  assert.equal(s.fallingGears[0].id, gear.id);
  assert.equal(s.fallingGears[0].hp, 2);
  const bounceY = e.y;
  frames(() => g._moveFlywheel(), 20);
  assert.ok(e.y < bounceY && e.vy < 0);
  frames(() => g._moveFlywheel(), 50);
  assert.ok(e.vy > 0);
  assert.equal(s.fallingGears.length, 1);
});

test("side and underside impacts reflect along the round gear's contact normal", () => {
  for (const [dx, dy, vx, vy, axis, sign] of [
    [-12, 0, 120, 0, "vx", -1],
    [12, 0, -120, 0, "vx", 1],
    [0, 10, 0, -120, "vy", 1],
  ]) {
    const { g, s } = lab();
    const gear = g.debug("gear", { col: 12, row: 12 });
    const e = wheel(g, { x: gear.x + dx, y: gear.y + dy, vx, vy });
    g._moveFlywheel();
    assert.equal(s.fallingGears.length, 1);
    assert.ok(e[axis] * sign > 0, JSON.stringify(e));
  }
});

test("an oblique bounce preserves tangent velocity and loses normal energy", () => {
  const { g, s } = lab();
  const gear = g.debug("gear", { col: 12, row: 12 });
  const e = wheel(g, { x: gear.x - 8.2, y: gear.y - 6.56, vx: 75, vy: 75 * ROUND_Y });
  const vx = e.vx, vy = e.vy + C.FLYWHEEL_GRAVITY * C.STEP;
  const at = sweepCircle(-8.2, -8.2, vx * C.STEP, vy * C.STEP / ROUND_Y, C.FLYWHEEL_RADIUS + C.FALLING_GEAR_RADIUS);
  assert.notEqual(at, null);
  const x = -8.2 + vx * C.STEP * at, y = -8.2 + vy * C.STEP / ROUND_Y * at;
  const len = Math.hypot(x, y), nx = x / len, ny = y / len;
  const tangent = -vx * ny + vy / ROUND_Y * nx;
  const energy = vx ** 2 + (vy / ROUND_Y) ** 2;
  g._moveFlywheel();
  assert.equal(s.fallingGears.length, 1);
  close(-e.vx * ny + e.vy / ROUND_Y * nx, tangent);
  assert.ok(e.vx ** 2 + (e.vy / ROUND_Y) ** 2 < energy);
});

test("a high-speed flywheel cannot tunnel through a mounted gear", () => {
  const { g, s } = lab();
  g.debug("gear", { col: 12, row: 12 });
  wheel(g, { x: 100, y: 65, vx: 0, vy: 2400 });
  g._moveFlywheel();
  assert.equal(s.gears.length, 0);
  assert.equal(s.fallingGears.length, 1);
  assert.ok(s.flywheel.vy < 0);
});

test("flywheel collision and debris motion respect the horizontal seam", () => {
  const { g, s } = lab();
  const gear = g.debug("gear", { col: 0, row: 12 });
  const e = wheel(g, { x: 232, y: 100, vx: 120 });
  g._moveFlywheel();
  assert.ok(e.vx < 0);
  assert.equal(s.fallingGears[0].id, gear.id);
  Object.assign(s.fallingGears[0], { x: 239.9, vx: 20 });
  g._moveFallingGears();
  assert.ok(s.fallingGears[0].x < 1);
  Object.assign(e, { x: 239, y: 60, vx: 120, vy: 0 });
  g._moveFlywheel();
  close(e.x, 1);
});

test("loose gears accelerate, cross the whole shooter band, then leave without becoming mounted", () => {
  const { g, s } = lab();
  s.fallingGears.push({ id: 999, x: 60, y: 190, vx: 0, vy: 8, angle: 0, spin: 5 });
  let entered = false, bottom = false;
  for (let i = 0; i < 150; i++) {
    g._moveFallingGears();
    const e = s.fallingGears[0];
    if (e?.y >= 212) entered = true;
    if (e?.y >= 252) bottom = true;
  }
  assert.ok(entered && bottom);
  assert.equal(s.fallingGears.length, 0);
  assert.equal(s.gears.length, 0);
});

test("the flywheel and falling gears hurt the shooter, including across the seam", () => {
  for (const type of ["flywheel", "fallingGear"]) {
    const { g, s } = lab();
    s.player = { x: 239, y: 248 };
    if (type === "flywheel") wheel(g, { x: 2, y: 246 });
    else s.fallingGears.push({ id: 99, x: 2, y: 246 });
    g._checkPlayerCollision();
    assert.equal(s.mode, "dying");
  }
});

test("one shot destroys a loose gear or flywheel with correct score, without tunneling", () => {
  for (const type of ["flywheel", "fallingGear"]) {
    const { g, s } = lab();
    if (type === "flywheel") wheel(g, { x: 2, y: 230 });
    else s.fallingGears.push({ id: 99, x: 2, y: 230 });
    s.bullet = { x: 239, y: 234 };
    g._moveBullet();
    assert.equal(s.bullet, null);
    assert.equal(type === "flywheel" ? s.flywheel : s.fallingGears[0], type === "flywheel" ? null : undefined);
    assert.equal(s.score, type === "flywheel" ? 1000 : 1);
  }
});

test("flywheel departure schedules another arrival rather than accumulating active wheels", () => {
  const { g, s } = lab();
  wheel(g, { y: 264, vy: 100 });
  g._moveFlywheel();
  assert.equal(s.flywheel, null);
  close(s.timers.flywheel, C.FLYWHEEL_RESPAWN);
  frames(() => g._moveFlywheel(), 600);
  assert.equal(s.flywheel, null);
  frames(() => g._moveFlywheel(), 121);
  assert.ok(s.flywheel);
});

test("pause freezes the piston, flywheel and debris, while life reset clears all hazards", () => {
  const { g, s } = lab();
  gantry(g, { phase: "extend", extension: 20 });
  wheel(g);
  s.fallingGears.push({ id: 999, x: 50, y: 180, vx: 3, vy: 80, angle: 1, spin: 5 });
  g.pause();
  const before = g.inspect();
  frames(() => g.step({ dx: 4, fire: true }), 90);
  assert.deepEqual(g.inspect(), before);
  g.resume(); g.step();
  assert.ok(s.fallingGears[0].y > 180);
  g._spawnWave();
  assert.equal(s.gantry, null);
  assert.equal(s.flywheel, null);
  assert.equal(s.fallingGears.length, 0);
});
