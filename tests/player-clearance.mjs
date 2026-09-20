import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const output = "output/player-clearance";
const url = new URL(process.env.GAME_URL || "http://localhost:5178/");
url.search = "?test=1&controls=window&seed=4321";
const report = [];
await mkdir(output, { recursive: true });

for (const [name, type, options] of [
  ["chrome", chromium, { channel: "chrome" }],
  ["webkit", webkit, {}],
]) {
  const browser = await type.launch({ headless: true, ...options });
  try {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 514, height: 683 },
    ]) {
      const label = `${name}-${viewport.width}x${viewport.height}`;
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const errors = [];
      const checks = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      const check = (description) => {
        checks.push(description);
        console.log(`${label}: ${description}`);
      };
      const state = () =>
        page.evaluate(() => JSON.parse(window.render_game_to_text()));
      const frames = (count) =>
        page.evaluate((n) => window.__chainDrive.stepFrames(n), count);
      const setup = (scenario = {}) =>
        page.evaluate((scenario) => {
          const a = window.__chainDrive;
          a.input.clear();
          a.game.start();
          a.game.debug("clear");
          a.game.debug("section", {
            count: scenario.count ?? 6,
            x: scenario.x ?? 80,
            y: scenario.row ?? 244,
            dir: scenario.dir ?? 1,
          });
          a.game.state.player = {
            x: scenario.playerX ?? 120,
            y: scenario.playerY ?? 252,
          };
          a.draw();
        }, scenario);
      const screenshot = async (suffix, full = false) => {
        const box = await page.locator("canvas").boundingBox();
        await page.screenshot({
          path: `${output}/${label}-${suffix}.png`,
          clip: {
            x: box.x,
            y: box.y + (box.height * 232) / 256,
            width: box.width,
            height: (box.height * 24) / 256,
          },
        });
        if (full)
          await page.screenshot({ path: `${output}/${label}-full.png` });
      };

      try {
        await page.goto(url.href);
        await page.waitForFunction(
          () => window.__chainDrive?.renderer.backgroundStatus === "ready",
        );
        await page.keyboard.press("Enter");
        assert.equal((await state()).mode, "playing");
        assert.equal((await state()).player.y, 252);
        check("Production Enter starts the shooter on the bottom row at y252");

        await setup({ count: 1, x: 124, row: 44 });
        await page.keyboard.down("ArrowUp");
        await frames(20);
        await page.keyboard.up("ArrowUp");
        const top = (await state()).player.y;
        await page.keyboard.down("ArrowDown");
        await frames(20);
        await page.keyboard.up("ArrowDown");
        const bottom = (await state()).player.y;
        assert.equal(top, 212);
        assert.equal(bottom, 252);
        assert.equal(bottom - top, 40);
        check("Keyboard movement retains the 40px vertical span from y212 to252");

        for (const dir of [1, -1]) {
          await setup({ x: dir > 0 ? 80 : 160, dir });
          await frames(20);
          const overhead = await state();
          assert.equal(overhead.mode, "playing");
          assert.equal(overhead.sections[0].links[0].x, 120);
          assert.equal(overhead.sections[0].links[0].y, 244);
          await screenshot(dir > 0 ? "overhead-right" : "overhead-left", dir > 0);
          const pass = await page.evaluate(() => {
            const a = window.__chainDrive;
            for (let n = 0; n < 40; n++) {
              a.stepFrames(1);
              if (a.game.state.mode !== "playing") return { safe: false };
            }
            return {
              safe: true,
              player: a.game.state.player,
              links: a.game.state.sections.flatMap((part) => part.links),
            };
          });
          assert.equal(pass.safe, true);
          assert.deepEqual(pass.player, { x: 120, y: 252 });
          assert.equal(pass.links.length, 6);
          assert.ok(pass.links.every((link) => link.y === 244));
          assert.ok(pass.links.every((link) => dir * (link.x - 120) > 0));
        }
        check("All six conveyor units pass directly overhead on row244 in both directions");

        await setup({ x: 118, row: 252 });
        await frames(1);
        assert.equal((await state()).mode, "dying");
        check("A conveyor on the shooter's own bottom row still collides");

        await setup({ x: 118 });
        const correction = () =>
          page.evaluate(() => {
            const a = window.__chainDrive;
            a.input.dy = -1;
            a.stepFrames(1);
          });
        await correction();
        assert.equal((await state()).player.y, 251);
        assert.equal((await state()).mode, "playing");
        await correction();
        assert.equal((await state()).player.y, 250);
        assert.equal((await state()).mode, "dying");
        check("Moving up to y251 is safe; entering the overhead unit at y250 collides");

        await setup({ x: 118 });
        await page.keyboard.down("Space");
        await frames(1);
        await page.keyboard.up("Space");
        const shot = await state();
        assert.equal(shot.mode, "playing");
        assert.equal(shot.player.y, 252);
        assert.equal(shot.sections.flatMap((part) => part.links).length, 5);
        assert.equal(shot.score, 100);
        check("Firing upward from the bottom row hits the overhead conveyor head");

        for (const [key, x, suffix] of [
          ["ArrowLeft", 4, "left-corner"],
          ["ArrowRight", 236, "right-corner"],
        ]) {
          await setup({ count: 1, row: 44, x: 124 });
          await page.keyboard.down(key);
          await frames(80);
          await page.keyboard.up(key);
          assert.deepEqual((await state()).player, { x, y: 252 });
          await page.evaluate((x) => {
            const a = window.__chainDrive;
            a.game.state.sections = [];
            a.game.debug("section", { count: 1, x, y: 244, dir: x === 4 ? -1 : 1 });
            a.draw();
          }, x);
          await screenshot(suffix);
        }
        check("Both bottom corners remain reachable; edge and overhead artwork captured");
        assert.deepEqual(errors, []);
        report.push({ browser: name, version: browser.version(), viewport, checks, errors });
      } finally {
        await page.close();
        await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
      }
    }
  } finally {
    await browser.close();
  }
}
