import test from "node:test";
import assert from "node:assert/strict";
import { TrackballMotion } from "../src/trackball-motion.js";

function swipe(motion, distance, duration, samples = 6, start = 0) {
  for (let i = 1; i <= samples; i++) {
    motion.sample(distance / samples, 0, start + (i * duration) / samples);
  }
}

function coast(motion, hz = 60, cap = Infinity) {
  let distance = 0;
  for (let i = 0; i < hz * 3; i++) {
    const { dx } = motion.step(1 / hz);
    distance += Math.max(-cap, Math.min(cap, dx));
  }
  return distance;
}

test("a fast flick spins far while an equal-distance slow gesture stays precise", () => {
  const fast = new TrackballMotion();
  const slow = new TrackballMotion();
  swipe(fast, 24, 40);
  swipe(slow, 24, 300);
  assert.ok(fast.velocity.x > 900);
  assert.equal(slow.velocity.x, 0);
  // The real engine limits each axis to four pixels per fixed 60 Hz tick.
  // Enough actual travel must survive that limit to make a flick useful.
  assert.ok(coast(fast, 60, 4) > 70);
  assert.equal(coast(slow), 0);
});

test("gentle corrections and short high-speed jitter never coast", () => {
  const motion = new TrackballMotion();
  for (let i = 1; i <= 20; i++) motion.sample(0.3, -0.2, i * 8);
  assert.deepEqual(motion.step(1 / 60), { dx: 0, dy: 0 });
  motion.clear();
  for (let i = 1; i <= 4; i++) motion.sample(0.5, 0, i);
  assert.deepEqual(motion.step(1 / 60), { dx: 0, dy: 0 });
});

test("a tiny opposite gesture or a slow touch immediately brakes a spinning ball", () => {
  const motion = new TrackballMotion();
  swipe(motion, 24, 40);
  motion.sample(-0.1, 0, 48);
  assert.deepEqual(motion.velocity, { x: 0, y: 0 });
  assert.deepEqual(motion.step(1 / 60), { dx: 0, dy: 0 });
  swipe(motion, 24, 40, 6, 60);
  assert.ok(motion.velocity.x > 900);
  motion.sample(0.1, 0, 108);
  assert.deepEqual(motion.velocity, { x: 0, y: 0 });
});

test("direct movement holds sampled spin without adding extra displacement", () => {
  const motion = new TrackballMotion();
  swipe(motion, 24, 40);
  const velocity = { ...motion.velocity };
  assert.deepEqual(motion.step(1 / 60, true), { dx: 0, dy: 0 });
  assert.deepEqual(motion.velocity, velocity);
  assert.ok(motion.step(1 / 60).dx > 0);
});

test("clear removes spin and gesture history; a wall stops only its axis", () => {
  const motion = new TrackballMotion();
  for (let i = 1; i <= 6; i++) motion.sample(4, 4, (i * 40) / 6);
  motion.stopAxis("x");
  assert.equal(motion.velocity.x, 0);
  assert.ok(motion.velocity.y > 0);
  motion.sample(0, 4, 48);
  assert.equal(motion.velocity.x, 0, "old horizontal samples cannot relaunch");
  assert.ok(motion.step(1 / 60).dy > 0);
  motion.clear();
  motion.sample(0.1, 0, 52);
  assert.deepEqual(motion.step(1 / 60), { dx: 0, dy: 0 });
});

test("a pause between gestures prevents stale fast history from causing a launch", () => {
  const motion = new TrackballMotion();
  swipe(motion, 24, 40);
  motion.sample(0.2, 0, 200);
  assert.deepEqual(motion.velocity, { x: 0, y: 0 });
  assert.equal(coast(motion), 0);
});

test("event batching at 30, 60 and 120 Hz produces the same settled launch", () => {
  const velocities = [30, 60, 120].map((hz) => {
    const motion = new TrackballMotion();
    for (let i = 1; i <= hz; i++) {
      motion.sample(420 / hz, 0, (i * 1000) / hz);
    }
    return motion.velocity.x;
  });
  for (const value of velocities) assert.ok(Math.abs(value - 945) < 1e-8);
});

test("short flicks infer their event cadence without diluting the first sample", () => {
  const motion = new TrackballMotion();
  swipe(motion, 12, 40, 12);
  assert.ok(Math.abs(motion.velocity.x - 472.5) < 1e-8);
  assert.ok(coast(motion, 60, 4) > 50);
  const velocities = [2, 4, 8].map((samples) => {
    const ball = new TrackballMotion();
    swipe(ball, 28, 1000 / 15, samples);
    return ball.velocity.x;
  });
  for (const value of velocities) assert.ok(Math.abs(value - 945) < 1e-8);
});

test("analytic friction travels equally at 30, 60 and 120 Hz and eventually stops", () => {
  const distances = [30, 60, 120].map((hz) => {
    const motion = new TrackballMotion();
    swipe(motion, 24, 40);
    const distance = coast(motion, hz);
    assert.deepEqual(motion.velocity, { x: 0, y: 0 });
    return distance;
  });
  for (const value of distances) {
    assert.ok(Math.abs(value - distances[0]) < 1e-8);
  }
});

test("coarse clocks, backward timestamps and invalid input keep state finite and bounded", () => {
  const motion = new TrackballMotion();
  for (let i = 0; i < 20; i++) motion.sample(0.1, 0, 10);
  assert.deepEqual(motion.velocity, { x: 0, y: 0 });
  for (let i = 0; i < 200; i++) motion.sample(1e300, -1e300, 10);
  assert.ok(Math.hypot(motion.velocity.x, motion.velocity.y) <= 1200 + 1e-9);
  motion.sample(NaN, Infinity, NaN, Infinity);
  motion.sample(2, 1, 1);
  motion.sample(3, 2, NaN, -1);
  assert.deepEqual(motion.step(Infinity), { dx: 0, dy: 0 });
  assert.deepEqual(motion.step(-1), { dx: 0, dy: 0 });
  const { dx, dy } = motion.step(1 / 60);
  for (const value of [dx, dy, motion.velocity.x, motion.velocity.y]) {
    assert.ok(Number.isFinite(value));
  }
});
