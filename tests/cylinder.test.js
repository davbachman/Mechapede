import test from "node:test";
import assert from "node:assert/strict";
import { Game, C } from "../src/game.js";
import { wrapX, wrappedDelta } from "../src/topology.js";

function laboratory(options = {}) {
  const game = new Game({ seed: 123, variant: "cylinder" });
  game.start();
  game.debug("clear");
  const section = game.debug("section", { count: 4, x: 124, y: 60, dir: 1, ...options });
  game.drainEvents();
  return { game, state: game.state, section };
}
function frames(game, count, input = {}) {
  for (let i = 0; i < count; i++) game.step(input);
}
function close(actual, expected, message = "") {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} vs ${expected}`);
}

test("cylinder topology preserves interior coordinates and gives shortest signed seam distance", () => {
  assert.equal(wrapX(0), 0);
  assert.equal(wrapX(240), 0);
  assert.equal(wrapX(-1), 239);
  assert.equal(wrapX(721), 1);
  assert.equal(wrapX(-721), 239);
  assert.equal(wrapX(7.123456789), 7.123456789);
  assert.equal(wrappedDelta(-238), 2);
  assert.equal(wrappedDelta(238), -2);
  assert.equal(wrappedDelta(722), 2);
});

test("the archived Classic selector cannot start a different ruleset", () => {
  for (const variant of [undefined, "classic", "cylinder"]) {
    const game = new Game({ variant, highScore: 500 });
    game.start();
    assert.equal(game.state.variant, "cylinder");
    assert.equal(game.setVariant, undefined);
    game.state.player.x = 239;
    game.step({ dx: 4 });
    assert.equal(game.state.player.x, 3);
    assert.equal(game.state.highScore, 500);
    assert.equal("crawler" in game.state, false);
  }
});

for (const dir of [-1, 1]) {
  test(`cylinder conveyor slopes exactly one row per circuit and wraps continuously (dir ${dir})`, () => {
    const { game, section } = laboratory({ count: 1, x: dir > 0 ? 239 : 0, dir });
    const head = section.links[0];
    const startX = head.x;
    game.step();
    assert.equal(head.x, dir > 0 ? 1 : 238);
    close(head.y, 60 + 2 / 30);
    assert.equal(section.dir, dir);
    assert.equal(head.wrapStep, dir);
    close(Math.cos(head.angle), dir / Math.hypot(1, 1 / 30));
    frames(game, 119);
    assert.equal(head.x, startX);
    close(head.y, 68);
    assert.equal(section.dir, dir);
    assert.equal(section.turning, null);
  });

  test(`cylinder followers retain identity and sample seam history after a split (dir ${dir})`, () => {
    const { game, section } = laboratory({ count: 6, x: dir > 0 ? 236 : 3, dir });
    const ids = section.links.map(link => link.id);
    frames(game, 7);
    for (let i = 1; i < section.links.length; i++) {
      const link = section.links[i];
      const point = section.path[i * C.LINK_SPACING];
      assert.equal(link.id, ids[i]);
      close(link.x, point.x);
      close(link.y, point.y);
      assert.equal(link.wrapStep, point.wrapStep);
      assert.equal(Math.sign(Math.cos(link.angle)), dir);
    }
    game.debug("hitLink", { section, index: 2 });
    const survivors = game.state.sections.flatMap(part => part.links.map(link => link.id)).sort((a, b) => a - b);
    assert.deepEqual(survivors, ids.filter((_, i) => i !== 2).sort((a, b) => a - b));
    // The destroyed unit creates a gear; remove it to isolate split path continuity.
    game.state.gears = [];
    for (let n = 0; n < 15; n++) {
      const previous = new Map(game.state.sections.flatMap(part => part.links.map(link => [link.id, { ...link }])));
      game.step();
      for (const part of game.state.sections) for (const link of part.links) {
        const old = previous.get(link.id);
        assert.ok(Math.abs(wrappedDelta(link.x - old.x)) <= 2);
        assert.ok(Math.abs(link.y - old.y) <= 2);
        assert.equal(Math.sign(Math.cos(link.angle)), dir);
      }
    }
  });
}

test("cylinder conveyor bounces vertically at the bottom and player-region ceiling without a seam jump", () => {
  const { game, state, section } = laboratory({ count: 1, x: 239, y: 251.98 });
  state.player.x = 120;
  section.poisoned = false;
  game.step();
  const head = section.links[0];
  close(head.y, 252 - (2 / 30 - 0.02));
  assert.equal(head.x, 1);
  assert.equal(section.vertical, -1);
  assert.equal(section.inPlayer, true);
  assert.equal(state.lowerReached, true);
  head.y = 212.02;
  game.step();
  close(head.y, 212 + (2 / 30 - 0.02));
  assert.equal(section.vertical, 1);
  assert.equal(section.dir, 1);
});

test("cylinder poison clears at the bottom and turning remains inside the player region", () => {
  const { game, section } = laboratory({ count: 1, x: 80, y: 251.5, poisoned: true });
  game.step();
  assert.equal(section.poisoned, false);
  assert.equal(section.vertical, -1);
  assert.ok(section.links[0].y <= 252);
  frames(game, 30);
  assert.ok(section.links[0].y >= 212 && section.links[0].y <= 252);
});

test("an unobstructed cylinder train descends naturally and keeps circulating through the player region", () => {
  const { game, state, section } = laboratory({ count: 12, y: 4 });
  const ids = section.links.map(link => link.id);
  let entered = false;
  const verticalDirections = new Set();
  // Exercise the entire top-to-bottom journey and several full lower-band bounces.
  // Advance conveyors alone so a stationary player does not terminate the journey.
  for (let frame = 0; frame < 12000; frame++) {
    game._moveChains();
    if (section.inPlayer) {
      entered = true;
      verticalDirections.add(section.vertical);
      assert.ok(section.links.every(link => link.y >= 212 && link.y <= 252));
    }
  }
  assert.equal(entered, true);
  assert.equal(state.lowerReached, true);
  assert.deepEqual([...verticalDirections].sort(), [-1, 1]);
  assert.deepEqual(section.links.map(link => link.id), ids);
  assert.equal(section.dir, 1);
  assert.ok(section.links[0].wrapStep > 50);
});

test("cylinder shooter wraps both ways, retains motion caps and vertical limits, and does not drift", () => {
  const { game, state } = laboratory();
  state.player = { x: 238, y: 250 };
  game.step({ dx: 100, dy: 100 });
  assert.deepEqual(state.player, { x: 2, y: 252 });
  game.step();
  assert.deepEqual(state.player, { x: 2, y: 252 });
  game.step({ dx: -100, dy: -100 });
  assert.deepEqual(state.player, { x: 238, y: 248 });
  frames(game, 20, { dy: -100 });
  assert.equal(state.player.y, 212);
});

test("cylinder gear tiles obstruct movement and turn sloped conveyors across the seam", () => {
  const { game, state, section } = laboratory({ count: 1, x: 228, y: 84.25 });
  const gear = game.debug("gear", { col: 0, row: 10 });
  assert.equal(game._gearAt(244, 84), gear);
  frames(game, 10);
  assert.equal(section.dir, -1);
  assert.ok(section.links[0].y > 92 && section.links[0].y < 94);
  assert.equal(game.drainEvents().filter(e => e.type === "gear-contact").length, 1);
  game.debug("gear", { col: 0, row: 28 });
  state.player = { x: 239, y: 228 };
  game.step({ dx: 4 });
  assert.equal(state.player.x, 239);
  game.step({ dx: -4 });
  assert.equal(state.player.x, 235);
});

test("cylinder destroyed-link gear addresses wrap to the opposing column", () => {
  for (const [x, dir, col] of [[239, 1, 0], [1, -1, 29]]) {
    const { game } = laboratory({ count: 2, x, dir, y: 84 });
    game.debug("hitLink", { index: 0 });
    assert.equal(game.state.gears[0].col, col);
  }
});

test("cylinder collision and bullet windows cross the seam and retain strict one-row clearance", () => {
  for (const x of [1, 239]) {
    const { game, state, section } = laboratory({ count: 2, x, y: 244 });
    state.player = { x: 240 - x, y: 252 };
    game._checkPlayerCollision();
    assert.equal(state.mode, "playing");
    section.links[0].y = 252;
    game._checkPlayerCollision();
    assert.equal(state.mode, "dying");
    const bulletCase = laboratory({ count: 1, x, y: 80 });
    bulletCase.state.bullet = { id: 999, x: 240 - x, y: 87 };
    bulletCase.game._moveBullet();
    assert.equal(bulletCase.state.bullet, null);
    assert.equal(bulletCase.state.score, C.HEAD_SCORE);
  }
});

test("cylinder simulation remains seeded, finite, bounded and identity-stable through sustained play", () => {
  const games = [new Game({ seed: 919, variant: "cylinder" }), new Game({ seed: 919, variant: "cylinder" })];
  for (const game of games) game.start();
  let resets = 0;
  for (let frame = 0; frame < 9000; frame++) {
    for (const game of games) {
      if (game.state.mode === "gameover") { game.start(); resets++; }
      game.step({ dx: Math.sin(frame / 37) * 5, dy: Math.sin(frame / 71) * 3, fire: true });
      const state = game.state;
      assert.ok(state.player.x >= 0 && state.player.x < 240);
      assert.ok(state.player.y >= 212 && state.player.y <= 252);
      const links = state.sections.flatMap(part => part.links);
      assert.equal(new Set(links.map(link => link.id)).size, links.length);
      for (const link of links) {
        assert.ok(link.x >= 0 && link.x < 240);
        assert.ok(link.y >= 0 && link.y <= 252, `y=${link.y}`);
        assert.ok(Number.isFinite(link.angle));
      }
    }
  }
  assert.ok(resets > 0);
  assert.deepEqual(games[0].inspect(), games[1].inspect());
});
