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
        page.evaluate(async (scenario) => {
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
          a.input.canvas.focus({ preventScroll: true });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
          await setup({ count: 1, x: 120, row: 244, dir });
          await page.evaluate(() => window.__chainDrive.game._checkPlayerCollision());
          assert.equal((await state()).mode, "playing");
          await screenshot(dir > 0 ? "overhead-right" : "overhead-left", dir > 0);
          await frames(1);
          assert.equal((await state()).mode, "playing");
          assert.ok(Math.abs((await state()).sections[0].links[0].y - (244 + 2 / 30)) < 1e-8);
        }
        check("A unit one row above the bottom fits overhead while continuing the Cylinder slope");

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
        assert.equal((await state()).mode, "dying");
        check("Moving up into a conveyor that is sloping downward still collides");

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
          ["ArrowLeft", 60, "left-wrap"],
          ["ArrowRight", 180, "right-wrap"],
        ]) {
          await setup({ count: 1, row: 44, x: 124 });
          await page.keyboard.down(key);
          await frames(100);
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
        check("Horizontal movement wraps in both directions; overhead artwork captured");
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
