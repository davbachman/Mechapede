import test from "node:test";
import assert from "node:assert/strict";
import { Game, C } from "../src/game.js";

function laboratory({ count = 5, x = 124, y = 84, dir = 1 } = {}) {
  const g = new Game({ seed: 123 });
  g.start();
  g.debug("clear");
  const section = g.debug("section", { count, x, y, dir });
  g.drainEvents();
  return { g, s: g.state, section };
}
function frames(g, n, input = {}) {
  for (let i = 0; i < n; i++) g.step(input);
}
const countLinks = (g) =>
  g.state.sections.reduce((n, s) => n + s.links.length, 0);

test("seeded start and new-game restart produce the same complete field", () => {
  const g = new Game({ seed: 123 });
  g.start();
  const initial = g.inspect();
  assert.equal(initial.mode, "playing");
  assert.equal(initial.lives, 3);
  assert.equal(countLinks(g), 12);
  assert.equal(initial.chainSpeed, 120);
  assert.equal(initial.player.y, 252);
  assert.ok(initial.gears.length <= 46 && initial.gears.length > 30);
  assert.equal(
    new Set(initial.gears.map((g) => `${g.col},${g.row}`)).size,
    initial.gears.length,
  );
  assert.ok(
    initial.gears.every((g) => g.hp === 4 && g.row >= 4 && g.row <= 29),
  );
  g.debug("score", { points: 12500 });
  frames(g, 60, { fire: true });
  const highScore = g.state.highScore;
  g.start();
  assert.deepEqual(g.state.gears, initial.gears);
  assert.equal(g.state.score, 0);
  assert.equal(g.state.highScore, highScore);
});

test("pause freezes exact state and resume deliberately clears pending input", () => {
  const { g } = laboratory();
  g.step({ dx: 1 }, 1 / 120);
  g.pause();
  const paused = g.inspect();
  frames(g, 30, { dx: 4, fire: true });
  assert.deepEqual(g.inspect(), paused);
  assert.equal(g.state.beforePause, "playing");
  g.resume();
  g.step();
  assert.equal(g.state.player.x, 120);
  assert.equal(g.state.bullet, null);
});

test("player has two axes, no momentum, a four-pixel per-axis frame cap, and bounds", () => {
  const { g, s } = laboratory();
  g.step({ dx: 100, dy: -100 });
  assert.deepEqual(s.player, { x: 124, y: 248 });
  g.step();
  assert.deepEqual(s.player, { x: 124, y: 248 });
  frames(g, 70, { dx: -100, dy: -100 });
  assert.deepEqual(s.player, { x: 4, y: 212 });
  frames(g, 100, { dx: 100, dy: 100 });
  assert.deepEqual(s.player, { x: 236, y: 252 });
});

test("player movement checks solid mounted gear tiles on each axis", () => {
  const { g, s } = laboratory();
  g.debug("gear", { col: 15, row: 28 });
  s.player = { x: 124, y: 238 };
  frames(g, 10, { dy: -4 });
  assert.equal(s.player.y, 232);
  frames(g, 2, { dx: -4 });
  frames(g, 3, { dy: -4 });
  assert.equal(s.player.y, 220); // Can steer around the blocked tile.
});

test("the bottom-row shooter fits beneath every link on the second-lowest row", () => {
  for (const dir of [-1, 1]) {
    for (const speed of [C.CHAIN_SPEED, C.FAST_CHAIN_SPEED]) {
      const { g, s, section } = laboratory({
        count: 6, x: dir > 0 ? 92 : 156, y: 244, dir,
      });
      s.player.x = 124;
      s.chainSpeed = speed;
      for (let n = 0; n < 80 / (speed * C.STEP); n++) {
        g.step();
        assert.equal(s.mode, "playing", `dir=${dir}, speed=${speed}, frame=${n}`);
      }
      assert.equal(s.lives, 3);
      assert.ok(section.links.every((link) => dir * (link.x - s.player.x) > 6));
    }
  }
});

test("a conveyor on the lowest row still hits the bottom-row shooter", () => {
  for (const dir of [-1, 1]) {
    const { g, s } = laboratory({ count: 6, x: dir > 0 ? 92 : 156, y: 252, dir });
    s.player.x = 124;
    for (let n = 0; n < 40 && s.mode === "playing"; n++) g.step();
    assert.equal(s.mode, "dying");
    assert.equal(s.lives, 2);
  }
});

test("moving up into the second-lowest row retains the original strict collision window", () => {
  for (const clearance of [8, 7, 6, 0]) {
    const { g, s } = laboratory({ count: 1, x: 124, y: 244 });
    s.player = { x: 124, y: 244 + clearance };
    g._checkPlayerCollision();
    assert.equal(s.mode, clearance >= 7 ? "playing" : "dying");
  }
});

test("one cutting pulse travels seven pixels per frame; holding fire repeats after slot frees", () => {
  const { g, s } = laboratory({ y: 36 });
  s.player.x = 220;
  g.step({ fire: true });
  const id = s.bullet.id,
    y = s.bullet.y;
  g.step({ fire: true });
  assert.equal(s.bullet.id, id);
  assert.equal(s.bullet.y, y - 7);
  frames(g, 40, { fire: true });
  assert.ok(g.drainEvents().filter((e) => e.type === "fire").length >= 2);
  assert.ok(s.bullet === null || typeof s.bullet.id === "number");
});

test("the addressed gear consumes a pulse and cannot damage a chain behind it", () => {
  const { g, s, section } = laboratory({ x: 124, y: 196 });
  const gear = g.debug("gear", { col: 15, row: 27 });
  s.bullet = { x: 124, y: 229 };
  g.step();
  assert.equal(gear.hp, 3);
  assert.equal(section.links.length, 5);
  assert.equal(s.bullet, null);
});

test("a gear has four distinct damage states and scores only on the fourth hit", () => {
  const { g, s } = laboratory();
  const gear = g.debug("gear", { col: 10, row: 15 });
  for (let n = 1; n <= 3; n++) {
    g.debug("hitGear", { id: gear.id });
    assert.equal(gear.hp, 4 - n);
    assert.equal(s.score, 0);
  }
  g.debug("hitGear", { id: gear.id });
  assert.equal(s.gears.length, 0);
  assert.equal(s.score, 1);
});

for (const [label, index, lengths, score] of [
  ["leading", 0, [4], 100],
  ["middle", 2, [2, 2], 10],
  ["trailing", 4, [4], 10],
]) {
  test(`${label} link destruction preserves all surviving identities and correct sections/scoring`, () => {
    const { g, s, section } = laboratory();
    const ids = section.links.map((l) => l.id),
      positions = new Map(section.links.map((l) => [l.id, [l.x, l.y]]));
    g.debug("hitLink", { section: 0, index });
    assert.equal(countLinks(g), 4);
    assert.equal(s.score, score);
    assert.deepEqual(
      s.sections.map((p) => p.links.length),
      lengths,
    );
    assert.deepEqual(
      s.sections.flatMap((p) => p.links.map((l) => l.id)).sort((a, b) => a - b),
      ids.filter((id, i) => i !== index),
    );
    for (const p of s.sections) {
      assert.equal(p.links[0].leader, true);
      assert.equal(p.links[0].isHead, true);
      assert.ok(p.links.slice(1).every((l) => !l.leader));
      for (const link of p.links)
        assert.deepEqual([link.x, link.y], positions.get(link.id));
    }
    assert.equal(s.gears.length, 1);
    assert.equal(
      g.drainEvents().filter((e) => e.type === "head-activate").length,
      index === 4 ? 0 : 1,
    );
  });
}

test("a newly active link keeps its velocity, shape/hitbox identity, and gains no immunity", () => {
  const { g, s, section } = laboratory();
  const second = section.links[1];
  g.debug("hitLink", { index: 0 });
  assert.equal(s.sections[0].links[0], second);
  assert.equal(s.sections[0].dir, 1);
  assert.equal(s.sections[0].turning, null);
  assert.equal(second.activation, 0.3);
  g.debug("hitLink", { index: 0 });
  assert.equal(countLinks(g), 3);
  assert.equal(s.score, 200);
});

test("turning at a gear takes an eight-pixel diagonal U-turn with reversal halfway", () => {
  const { g, section } = laboratory({ x: 124, y: 84 });
  g.state.chainSpeed = 60;
  g.debug("gear", { col: 16, row: 10 });
  frames(g, 4);
  assert.deepEqual(
    [section.links[0].x, section.links[0].y, section.dir],
    [128, 88, -1],
  );
  frames(g, 4);
  assert.deepEqual([section.links[0].x, section.links[0].y], [124, 92]);
  assert.equal(section.turning, null);
  frames(g, 8);
  assert.deepEqual([section.links[1].x, section.links[1].y], [124, 92]);
});

test("boundary U-turns keep the head within its four-pixel edge excursion", () => {
  const { g, section } = laboratory({ x: 236, y: 84 });
  frames(g, 4);
  assert.equal(section.dir, -1);
  assert.equal(section.links[0].y, 92);
  assert.equal(section.links[0].x, 236);
});

test("head overlap in a row makes an independent section turn", () => {
  const { g, section } = laboratory({ count: 1, x: 100, y: 84 });
  g.debug("section", { count: 1, x: 108, y: 84 });
  g.step();
  assert.ok(section.links[0].y > 84);
});

test("electrified contact sends the chain down successive rows and head destruction clears it", () => {
  const { g, s, section } = laboratory({ x: 100, y: 100 });
  g.debug("gear", { col: 13, row: 12, electrified: true });
  frames(g, 8);
  assert.equal(section.poisoned, true);
  assert.equal(section.links[0].y, 116);
  g.debug("hitLink", { index: 0 });
  assert.equal(s.sections[0].poisoned, false);
  assert.equal(s.sections[0].links[0].leader, true);
});

test("poison clears at the bottom; an entered section stays in the player band", () => {
  const { g, section } = laboratory({ count: 1, x: 124, y: 244 });
  g.state.player.x = 220;
  section.poisoned = true;
  frames(g, 5);
  assert.equal(section.poisoned, false);
  assert.equal(section.inPlayer, true);
  frames(g, 150);
  assert.ok(section.links[0].y >= C.PLAYER_MIN_Y && section.links[0].y <= 252);
});

test("a tail becomes an existing independent link only when it too is on the bottom row", () => {
  const { g, s, section } = laboratory({ count: 3, x: 236, y: 252 });
  const tail = section.links.at(-1);
  g.step();
  assert.equal(countLinks(g), 3);
  assert.equal(s.sections.length, 2);
  assert.equal(s.sections[1].links[0], tail);
  assert.equal(tail.leader, true);
  assert.equal(section.links.length, 2);
});

test("bottom arrival enables side heads, accelerates arrivals, and respects twelve slots", () => {
  const { g, s } = laboratory({ count: 1, x: 80, y: 252 });
  s.lowerReached = true;
  s.timers.extraHead = 0;
  g.step();
  assert.equal(countLinks(g), 2);
  const added = s.sections.find((p) => p.added);
  assert.ok(added.fast);
  assert.equal(added.links[0].y, 196);
  const delay = s.timers.extraHead;
  s.timers.extraHead = 0;
  g.step();
  assert.ok(s.timers.extraHead < delay);
  while (countLinks(g) < 12) g.debug("section", { count: 1, x: 100, y: 12 });
  s.timers.extraHead = 0;
  g.step();
  assert.equal(countLinks(g), 12);
});

test("wave sequence alternates fast/slow and replaces body links with detached fast heads", () => {
  const g = new Game();
  g.start();
  for (const [wave, length, speed] of [
    [1, 12, 120],
    [2, 11, 60],
    [3, 11, 120],
    [4, 10, 60],
    [22, 1, 60],
    [23, 1, 120],
    [24, 12, 60],
  ]) {
    g.debug("wave", { wave });
    assert.equal(g.state.mainLength, length);
    assert.equal(g.state.chainSpeed, speed);
    assert.equal(countLinks(g), 12);
    assert.equal(g.state.sections.length, 13 - length);
    assert.ok(g.state.sections.slice(1).every((s) => s.fast));
  }
});

test("a slow-wave split inherits its parent speed; only the final live link accelerates", () => {
  const g = new Game();
  g.start();
  g.debug("wave", { wave: 2 });
  const main = g.state.sections[0];
  g.debug("hitLink", { section: main, index: 9 });
  const solo = g.state.sections.at(-1);
  assert.equal(g._speed(solo), 60);
  const fast = g.state.sections.find((s) => s.fast);
  assert.equal(g._speed(fast), 120);
  g.state.sections = [solo];
  assert.equal(g._speed(solo), 120);
});

test("at forty thousand the next cycle remains fast and lengths shrink each wave", () => {
  const g = new Game();
  g.start();
  g.debug("score", { points: 40000 });
  g.debug("wave", { wave: 2 });
  assert.equal(g.state.chainSpeed, 120);
  assert.equal(g.state.mainLength, 11);
  g.debug("wave", { wave: 3 });
  assert.equal(g.state.chainSpeed, 120);
  assert.equal(g.state.mainLength, 10);
});

test("destroying the last link transitions through the wave delay and preserves damaged gears", () => {
  const { g, s } = laboratory({ count: 1 });
  const gear = g.debug("gear", { col: 4, row: 10, hp: 2, electrified: true });
  g.debug("hitLink", { index: 0 });
  g.step();
  assert.equal(s.mode, "wave");
  frames(g, 66);
  assert.equal(s.mode, "playing");
  assert.equal(s.wave, 2);
  assert.equal(gear.hp, 2);
  assert.equal(gear.electrified, true);
});

test("chain contact destroys the player before a coincident shot can save them", () => {
  const { g, s } = laboratory({ count: 1, x: 120, y: 252 });
  s.bullet = { x: 120, y: 256 };
  g.step({ fire: true });
  assert.equal(s.mode, "dying");
  assert.equal(s.lives, 2);
  assert.equal(s.score, 0);
});

test("life restart repairs each damaged/electrified gear once for five, persisting the field", () => {
  const { g, s } = laboratory();
  const a = g.debug("gear", { col: 5, row: 9, hp: 2, electrified: true });
  const b = g.debug("gear", { col: 6, row: 9, electrified: true });
  const c = g.debug("gear", { col: 7, row: 9 });
  g.debug("kill");
  frames(g, 31);
  assert.equal(a.hp, 2);
  frames(g, 100);
  assert.equal(s.mode, "playing");
  assert.equal(s.lives, 2);
  assert.equal(s.score, 10);
  assert.equal(s.gears.length, 3);
  assert.ok([a, b, c].every((g) => g.hp === 4 && !g.electrified));
  assert.equal(
    g.drainEvents().filter((e) => e.type === "gear-repair").length,
    2,
  );
});

test("game over retains high score and a new game reliably resets transient state", () => {
  const { g, s } = laboratory();
  s.lives = 1;
  g.debug("score", { points: 123 });
  g.debug("kill");
  frames(g, 100);
  assert.equal(s.mode, "gameover");
  g.start();
  assert.equal(g.state.mode, "playing");
  assert.equal(g.state.lives, 3);
  assert.equal(g.state.score, 0);
  assert.equal(g.state.highScore, 123);
  assert.equal(countLinks(g), 12);
});

test("bonuses award each twelve thousand, cap six reserves plus active, and stay silent at the cap", () => {
  const { g, s } = laboratory();
  g.debug("score", { points: 11999 });
  assert.equal(s.lives, 3);
  g.debug("score", { points: 1 });
  assert.equal(s.lives, 4);
  g.debug("score", { points: 24000 });
  assert.equal(s.lives, 6);
  g.debug("score", { points: 12000 });
  assert.equal(s.lives, 7);
  g.drainEvents();
  g.debug("score", { points: 12000 });
  assert.equal(s.lives, 7);
  assert.equal(
    g.drainEvents().filter((e) => e.type === "extra-life").length,
    0,
  );
});

test("crawler enters on its cooldown, moves diagonally/vertically, and removes only its current tile", () => {
  const { g, s } = laboratory();
  s.timers.crawler = 0;
  g.step();
  assert.ok(s.crawler);
  const e = g.debug("enemy", {
    type: "crawler",
    x: 100,
    y: 204,
    vx: 0,
    vy: 1,
    phase: 1,
  });
  const target = g.debug("gear", { col: 12, row: 25 });
  const adjacent = g.debug("gear", { col: 13, row: 25 });
  g.step();
  assert.equal(e.x, 100);
  assert.equal(e.y, 205);
  assert.ok(!s.gears.includes(target));
  assert.ok(s.gears.includes(adjacent));
});

test("crawler score uses vertical proximity with arcade thresholds, independent of horizontal offset", () => {
  for (const [distance, points] of [
    [0, 900],
    [21, 900],
    [22, 600],
    [63, 600],
    [64, 300],
    [90, 300],
  ]) {
    const { g, s } = laboratory();
    g.debug("enemy", { type: "crawler", x: 10, y: s.player.y - distance });
    g.debug("hitEnemy", { type: "crawler" });
    assert.equal(s.score, points);
  }
});

test("crawler speed changes at five thousand and its upper boundary shrinks with high scores", () => {
  const { g, s } = laboratory();
  const e = g.debug("enemy", {
    type: "crawler",
    x: 100,
    y: 180,
    vx: 1,
    vy: 1,
    phase: 1,
  });
  g.step();
  assert.equal(e.x, 101);
  g.debug("score", { points: 5000 });
  g.step();
  assert.equal(e.x, 102);
  const fast = g.debug("enemy", {
    type: "crawler",
    x: 100,
    y: 180,
    vx: 1,
    vy: 1,
    phase: 1,
  });
  g.step();
  assert.equal(fast.x, 102);
  s.score = 80000;
  assert.equal(g._crawlerMinY(), 168);
  s.score = 160000;
  assert.equal(g._crawlerMinY(), 200);
});

test("dispenser eligibility requires a shorter main chain and few gears across bottom eleven rows", () => {
  const { g, s } = laboratory();
  s.timers.dispenser = 0;
  g.step();
  assert.equal(s.dispenser, null);
  s.mainLength = 11;
  g.step();
  assert.ok(s.dispenser);
  s.dispenser = null;
  for (let i = 0; i < 6; i++) g.debug("gear", { col: i + 2, row: 22 });
  g.step();
  assert.equal(s.dispenser, null);
});

test("dispenser drops immediate gears, needs two hits, and accelerates on its first hit", () => {
  const { g, s } = laboratory();
  const e = g.debug("enemy", { type: "dispenser", x: 100, y: 100 });
  const saved = g.random;
  g.random = () => 0;
  frames(g, 4);
  g.random = saved;
  assert.ok(s.gears.some((gear) => gear.col === 12));
  assert.equal(e.hp, 2);
  g.debug("hitEnemy", { type: "dispenser" });
  assert.equal(e.hp, 1);
  assert.equal(e.speed, 240);
  assert.equal(s.score, 0);
  g.debug("hitEnemy", { type: "dispenser" });
  assert.equal(s.dispenser, null);
  assert.equal(s.score, 200);
});

test("drone uses the shared slot, traverses an upper row, electrifies its tile and scores a thousand", () => {
  const { g, s } = laboratory();
  s.mainLength = 10;
  s.frame = 255;
  g.debug("enemy", { type: "dispenser", x: 100, y: 30 });
  const saved = g.random;
  g.random = () => 0;
  g.step();
  g.random = saved;
  assert.equal(s.drone, null);
  s.dispenser = null;
  const e = g.debug("enemy", {
    type: "drone",
    x: 100,
    y: 100,
    dir: 1,
    speed: 60,
  });
  const gear = g.debug("gear", { col: 12, row: 12, hp: 2 });
  g.step();
  assert.equal(e.x, 101);
  assert.equal(gear.electrified, true);
  assert.equal(gear.hp, 2);
  assert.equal(s.dispenser, null);
  g.debug("hitEnemy", { type: "drone" });
  assert.equal(s.score, 1000);
});

test("gear creation never heals an existing tile and omits the excluded edge rows", () => {
  const { g, s } = laboratory();
  const gear = g.debug("gear", { col: 12, row: 12, hp: 1, electrified: true });
  assert.equal(g._addGear(12, 12), gear);
  assert.equal(gear.hp, 1);
  assert.equal(gear.electrified, true);
  assert.equal(g.debug("gear", { col: 12, row: 30 }), null);
  assert.equal(s.gears.length, 1);
});

test("fixed simulation is identical at 30, 60, and 120 Hz display submission rates", () => {
  const snapshots = [];
  for (const hz of [30, 60, 120]) {
    const g = new Game({ seed: 873 });
    g.start();
    for (let i = 0; i < hz * 4; i++)
      g.step({ dx: 12 / hz, dy: -4 / hz, fire: true }, 1 / hz);
    snapshots.push(g.inspect());
  }
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.deepEqual(snapshots[1], snapshots[2]);
});

test("representative deterministic scenarios build without exceptions or malformed links", () => {
  const g = new Game();
  for (const name of ["crowded", "poison", "split", "enemies"]) {
    g.debug("scenario", { name });
    for (let n = 0; n < 30; n++) g.step({ fire: true });
    assert.ok(
      g.state.sections.every((s) =>
        s.links.every((l) => Number.isFinite(l.x) && Number.isFinite(l.y)),
      ),
    );
  }
});

test("wave intermission keeps player input, shots and supporting enemies active and preserves them", () => {
  const { g, s } = laboratory({ count: 1 });
  const crawler = g.debug("enemy", {
    type: "crawler",
    x: 20,
    y: 180,
    vx: 1,
    vy: 1,
    phase: 3,
  });
  g.debug("hitLink", { index: 0 });
  g.step();
  assert.equal(s.mode, "wave");
  const x = s.player.x,
    enemyX = crawler.x;
  g.step({ dx: 3, dy: -2, fire: true });
  assert.equal(s.player.x, x + 3);
  assert.equal(crawler.x, enemyX + 1);
  assert.ok(s.bullet);
  frames(g, 65);
  assert.equal(s.wave, 2);
  assert.equal(s.crawler, crawler);
});

test("death during a wave intermission restarts the forthcoming formation", () => {
  const { g, s } = laboratory({ count: 1 });
  g.debug("hitLink", { index: 0 });
  g.step();
  g.debug("kill");
  assert.equal(s.mode, "dying");
  frames(g, 100);
  assert.equal(s.wave, 2);
  assert.equal(s.mainLength, 11);
  assert.equal(s.mode, "playing");
});

test("replacement-head urgency persists across waves and lives", () => {
  const { g, s } = laboratory({ count: 1 });
  s.headsAdded = 7;
  s.timers.extraHead = 1.2;
  g.debug("hitLink", { index: 0 });
  g.step();
  frames(g, 66);
  assert.equal(s.headsAdded, 7);
  assert.equal(s.timers.extraHead, 1.2);
  g.debug("kill");
  frames(g, 100);
  assert.equal(s.headsAdded, 7);
  assert.equal(s.timers.extraHead, 1.2);
});

test("the reserve cap applies while dead and repair points can still rescue the final life", () => {
  const { g, s } = laboratory();
  s.lives = 7;
  g.debug("kill");
  assert.equal(s.lives, 6);
  g.drainEvents();
  g.debug("score", { points: 12000 });
  assert.equal(s.lives, 6);
  assert.equal(
    g.drainEvents().filter((e) => e.type === "extra-life").length,
    0,
  );
  frames(g, 60);
  assert.equal(s.mode, "playing");
  assert.equal(s.lives, 6);

  const last = laboratory();
  last.s.lives = 1;
  last.g.debug("score", { points: 11995 });
  last.g.debug("gear", { col: 8, row: 8, hp: 1 });
  last.g.debug("kill");
  frames(last.g, 100);
  assert.equal(last.s.score, 12000);
  assert.equal(last.s.mode, "playing");
  assert.equal(last.s.lives, 1);
});

test("projectile obstacle addressing precedes all overlapping moving-object slots", () => {
  const { g, s, section } = laboratory({ count: 1, x: 124, y: 114 });
  const gear = g.debug("gear", { col: 15, row: 14 });
  const crawler = g.debug("enemy", { type: "crawler", x: 124, y: 118 });
  s.bullet = { x: 124, y: 124 }; // Previous V lookup addresses row 14; new y is 117.
  g._moveBullet();
  assert.equal(gear.hp, 3);
  assert.equal(s.crawler, crawler);
  assert.equal(section.links.length, 1);
  assert.equal(s.score, 0);
  assert.equal(s.bullet, null);
});

test("projectiles scan crawler before the shared enemy and chain, regardless of nearer overlap", () => {
  const { g, s } = laboratory({ count: 1, x: 124, y: 119 });
  const dispenser = g.debug("enemy", { type: "dispenser", x: 124, y: 120 });
  g.debug("enemy", { type: "crawler", x: 124, y: 114 });
  s.bullet = { x: 124, y: 124 };
  g._moveBullet();
  assert.equal(s.crawler, null);
  assert.equal(s.dispenser, dispenser);
  assert.equal(dispenser.hp, 2);
  assert.equal(countLinks(g), 1);
});

test("the shared dispenser or drone slot precedes overlapping chain slots", () => {
  for (const type of ["dispenser", "drone"]) {
    const { g, s } = laboratory({ count: 1, x: 124, y: 119 });
    const enemy = g.debug("enemy", { type, x: 124, y: 114 });
    s.bullet = { x: 124, y: 124 };
    g._moveBullet();
    assert.equal(countLinks(g), 1);
    if (type === "dispenser") assert.equal(enemy.hp, 1);
    else {
      assert.equal(s.drone, null);
      assert.equal(s.score, 1000);
    }
  }
});

test("chain collision priority follows descending stable slots across splits and replacement reuse", () => {
  const { g, s, section } = laboratory({ count: 12, x: 124, y: 116 });
  const originalLast = section.links[11];
  assert.deepEqual(
    section.links.map((link) => link.slot),
    Array.from({ length: 12 }, (_, slot) => slot),
  );
  g.debug("hitLink", { index: 4 });
  const replacement = g.debug("section", {
    count: 1,
    x: 124,
    y: 116,
    added: true,
  }).links[0];
  assert.equal(replacement.slot, 4);
  assert.ok(replacement.id > originalLast.id);
  s.gears = [];
  for (const part of s.sections)
    for (const link of part.links) {
      link.x = 124;
      link.y = 116;
    }
  s.sections.reverse(); // Render/group ordering cannot change collision priority.
  s.bullet = { x: 124, y: 124 };
  g._moveBullet();
  const survivors = s.sections.flatMap((part) => part.links);
  assert.ok(!survivors.includes(originalLast));
  assert.ok(survivors.includes(replacement));
  assert.equal(countLinks(g), 11);
});

test("projectile hit windows are strict and do not include visual pulse length or a swept path", () => {
  for (const [x, y, hit] of [
    [124, 117, true],
    [129, 121, true],
    [130, 117, false],
    [124, 122, false],
    [124, 125, false],
  ]) {
    const { g, s } = laboratory({ count: 1, x, y });
    s.bullet = { x: 124, y: 124 };
    g._moveBullet();
    assert.equal(countLinks(g), hit ? 0 : 1, `link at ${x},${y}`);
  }
  for (const [type, offset, hit] of [
    ["crawler", 9, true],
    ["crawler", 10, false],
    ["drone", 9, true],
    ["drone", 10, false],
  ]) {
    const { g, s } = laboratory({ x: 40, y: 40 });
    g.debug("enemy", { type, x: 124 + offset, y: 117 });
    s.bullet = { x: 124, y: 124 };
    g._moveBullet();
    assert.equal(s[type] === null, hit);
  }
});

test("the first dispenser hit enlarges only its vertical projectile window", () => {
  const { g, s } = laboratory({ x: 40, y: 40 });
  const dispenser = g.debug("enemy", { type: "dispenser", x: 124, y: 123 });
  s.bullet = { x: 124, y: 124 };
  g._moveBullet();
  assert.equal(dispenser.hp, 2);
  g.debug("hitEnemy", { type: "dispenser" });
  s.bullet = { x: 124, y: 124 };
  g._moveBullet();
  assert.equal(s.dispenser, null);
});

test("the projectile leaves its slot at the original upper cutoff", () => {
  const { g, s } = laboratory({ x: 40, y: 40 });
  s.bullet = { x: 200, y: C.SHOT_TOP };
  g._moveBullet();
  assert.equal(s.bullet, null);
  s.bullet = { x: 200, y: C.SHOT_TOP + 1 };
  g._moveBullet();
  assert.equal(s.bullet.y, 7);
});
