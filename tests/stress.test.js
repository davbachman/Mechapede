import test from "node:test";
import assert from "node:assert/strict";
import { Game, C } from "../src/game.js";

test("ten seeded ten-minute runs keep geometry, entity identity and enemy slots valid", () => {
  let deaths = 0,
    restarts = 0,
    turns = 0,
    hits = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const game = new Game({ seed });
    game.start();
    for (let frame = 0; frame < 60 * 600; frame++) {
      if (game.state.mode === "gameover") {
        game.start();
        restarts++;
      }
      // Mix organic play with original later-wave configurations to cover the full cast.
      if (frame % 3600 === 0 && frame > 0)
        game.debug("wave", { wave: 2 + frame / 3600 });
      const dx = Math.sin(frame * 0.027 + seed) * 4;
      const dy = Math.cos(frame * 0.039 + seed) * 3;
      game.step({ dx, dy, fire: frame % 173 < 162 }, C.STEP);
      for (const e of game.drainEvents()) {
        if (e.type === "player-death") deaths++;
        if (e.type === "gear-contact") turns++;
        if (e.type === "link-destroy") hits++;
      }
      if (frame % 30 !== 0) continue;
      const s = game.state,
        links = s.sections.flatMap((section) => section.links);
      assert.ok(Number.isFinite(s.player.x) && Number.isFinite(s.player.y));
      assert.ok(s.player.x >= C.PLAYER_MIN_X && s.player.x <= C.PLAYER_MAX_X);
      assert.ok(s.player.y >= C.PLAYER_MIN_Y && s.player.y <= C.PLAYER_MAX_Y);
      assert.ok(
        links.length <= C.CHAIN_LENGTH,
        `seed ${seed}, frame ${frame}: too many links`,
      );
      assert.equal(new Set(links.map((l) => l.id)).size, links.length);
      for (const l of links) {
        assert.ok(
          Number.isFinite(l.x) && Number.isFinite(l.y),
          `nonfinite link seed ${seed}`,
        );
        assert.ok(
          l.x >= -8 && l.x <= 248 && l.y >= -8 && l.y <= 264,
          `seed ${seed}, frame ${frame}: link escaped field (${l.x}, ${l.y})`,
        );
      }
      for (const section of s.sections) {
        assert.ok(section.links.length > 0 && section.links[0].leader);
        assert.equal(section.links.filter((l) => l.leader).length, 1);
      }
      assert.equal(
        new Set(s.gears.map((g) => `${g.col},${g.row}`)).size,
        s.gears.length,
      );
      assert.ok(s.gears.every((g) => g.hp >= 1 && g.hp <= 4));
      assert.ok(!(s.dispenser && s.drone));
      assert.ok(
        Number.isInteger(s.score) && s.score >= 0 && s.highScore >= s.score,
      );
      assert.ok(s.lives >= 0 && s.lives <= C.MAX_LIVES);
    }
  }
  assert.ok(
    deaths > 20 && restarts > 5 && turns > 500 && hits > 100,
    JSON.stringify({ deaths, restarts, turns, hits }),
  );
});
