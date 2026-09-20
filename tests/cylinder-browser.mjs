import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";

// Preserve a deployed Pages subdirectory when adding deterministic test options.
const base = new URL(process.env.GAME_URL || "http://localhost:5178/");
const gameURL = (mode) => {
  const url = new URL(base);
  url.searchParams.set("test", "1");
  url.searchParams.set("controls", "window");
  url.searchParams.set("seed", "4321");
  if (mode) url.searchParams.set("mode", mode);
  else url.searchParams.delete("mode");
  return url.href;
};
const output = "output/cylinder";
const report = [];
await mkdir(output, { recursive: true });

for (const [name, browserType, options] of [
  ["chrome", chromium, { channel: "chrome" }],
  ["webkit", webkit, {}],
]) {
  const browser = await browserType.launch({ headless: true, ...options });
  const checks = [];
  const errors = [];
  const diagnostics = {};
  const check = (description) => {
    checks.push(description);
    console.log(`${name}: ${description}`);
  };
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const watchErrors = (target) => {
    target.on("pageerror", (error) => errors.push(error.message));
    target.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  };
  watchErrors(page);
  const load = async (mode) => {
    await page.goto(gameURL(mode));
    await page.waitForFunction(
      () => window.__chainDrive?.renderer.backgroundStatus === "ready",
    );
  };
  const state = () =>
    page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const frames = (count) =>
    page.evaluate((count) => window.__chainDrive.stepFrames(count), count);
  const setup = (scenario = {}) =>
    page.evaluate(async (scenario) => {
      const a = window.__chainDrive;
      a.setRealtime(false);
      a.game.start();
      a.game.debug("clear");
      a.game.debug("section", {
        count: scenario.count ?? 4,
        x: scenario.x ?? 124,
        y: scenario.y ?? 44,
        dir: scenario.dir ?? 1,
        ...(scenario.section || {}),
      });
      a.game.state.player = {
        x: scenario.playerX ?? 120,
        y: scenario.playerY ?? 252,
      };
      a.input.clear();
      a.draw();
      // Fixtures bypass handleAction(start), which normally focuses the canvas.
      // Finish the title-to-play layout/ResizeObserver cycle before holding keys.
      a.input.canvas.focus({ preventScroll: true });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, scenario);
  const menu = () =>
    page.evaluate(() => {
      const a = window.__chainDrive;
      a.input.clear();
      a.game.state.mode = "gameover";
      a.draw();
    });
  const highScores = () =>
    page.evaluate(() => ({
      classic: JSON.parse(localStorage.getItem("chain-drive.high-score")),
      cylinder: JSON.parse(
        localStorage.getItem("chain-drive.high-score-cylinder"),
      ),
    }));
  try {
    await load();
    assert.equal((await state()).variant, "classic");
    assert.equal(await page.locator("#variant-classic").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#variant-picker").isVisible(), true);
    check("A fresh visit defaults to Classic with an accessible mode picker");

    await page.evaluate(() => {
      localStorage.setItem("chain-drive.high-score", "4321");
      localStorage.setItem("chain-drive.high-score-cylinder", "1234");
    });
    await load();
    assert.equal((await state()).highScore, 4321);
    await page.locator("#variant-cylinder").click();
    assert.equal((await state()).variant, "cylinder");
    assert.equal((await state()).highScore, 1234);
    assert.equal(await page.locator("#variant-cylinder").getAttribute("aria-pressed"), "true");
    assert.match(await page.locator("#variant-description").textContent(), /slope|descend|row|lower/i);
    assert.match(await page.locator("#variant-label").textContent(), /cylinder/i);
    await page.keyboard.press("Enter");
    assert.equal((await state()).mode, "playing");
    assert.equal((await state()).variant, "cylinder");
    assert.equal(await page.locator("#variant-picker").isVisible(), false);
    assert.equal(await page.evaluate(() => window.__chainDrive.game.setVariant("classic")), false);
    check("The title picker selects Cylinder; Enter starts it and active play cannot change modes");

    await page.evaluate(() => {
      window.__chainDrive.game.debug("score", { points: 1500 });
      window.__chainDrive.draw();
    });
    assert.deepEqual(await highScores(), { classic: 4321, cylinder: 1500 });
    await menu();
    assert.equal(await page.locator("#variant-picker").isVisible(), true);
    await page.locator("#variant-classic").click();
    assert.equal((await state()).highScore, 4321);
    await page.keyboard.press("Enter");
    await page.evaluate(() => {
      window.__chainDrive.game.debug("score", { points: 5000 });
      window.__chainDrive.draw();
    });
    assert.deepEqual(await highScores(), { classic: 5000, cylinder: 1500 });
    await menu();
    await page.locator("#variant-cylinder").click();
    await load();
    assert.equal((await state()).variant, "cylinder");
    assert.equal((await state()).highScore, 1500);
    check("Game-over switching and reload retain the choice and keep both high scores separate");

    await load("classic");
    assert.equal((await state()).variant, "classic");
    await load("cylinder");
    assert.equal((await state()).variant, "cylinder");
    check("Explicit mode URLs override the saved choice and retain the deployment path");

    for (const [key, start, end] of [
      ["ArrowRight", 238, 1],
      ["ArrowLeft", 1, 238],
    ]) {
      await setup({ playerX: start });
      await page.keyboard.down(key);
      await frames(1);
      await page.keyboard.up(key);
      assert.equal((await state()).player.x, end);
    }
    await setup({ playerX: 239 });
    const spin = await page.evaluate(() => {
      const a = window.__chainDrive;
      a.input.spin.velocity.x = 300;
      a.stepFrames(1);
      const first = { x: a.game.state.player.x, velocity: a.input.spin.velocity.x };
      a.stepFrames(1);
      return { first, second: { x: a.game.state.player.x, velocity: a.input.spin.velocity.x } };
    });
    assert.ok(spin.first.x >= 0 && spin.first.x < 4, JSON.stringify(spin));
    assert.ok(spin.first.velocity > 0);
    assert.ok(spin.second.x > spin.first.x);
    assert.ok(spin.second.velocity > 0 && spin.second.velocity < spin.first.velocity);
    diagnostics.seamSpin = spin;
    check("Keyboard steering wraps both ways and trackball spin survives crossing the seam");

    for (const dir of [1, -1]) {
      const startX = dir > 0 ? 239 : 1;
      await setup({ x: startX, y: 100, dir });
      await frames(1);
      const first = (await state()).sections[0].links[0];
      assert.ok(Math.abs(first.x - (dir > 0 ? 1 : 239)) < 1e-8);
      assert.ok(Math.abs(first.y - (100 + 2 / 30)) < 1e-8, JSON.stringify(first));
      await frames(119);
      const circuit = (await state()).sections[0].links[0];
      assert.ok(Math.abs(circuit.x - startX) < 1e-8);
      assert.ok(Math.abs(circuit.y - 108) < 1e-8, JSON.stringify(circuit));
      assert.equal((await state()).sections[0].dir, dir);
    }
    check("Conveyors in either direction descend exactly eight pixels per full circuit with no seam jump");

    await setup({ count: 1, x: 20, y: 251.98, section: { inPlayer: true } });
    await frames(1);
    let part = (await state()).sections[0];
    assert.equal(part.vertical, -1);
    assert.ok(part.links[0].y < 252 && part.links[0].y > 251.9);
    await setup({ count: 1, x: 20, y: 212.02, section: { inPlayer: true, vertical: -1 } });
    await frames(1);
    part = (await state()).sections[0];
    assert.equal(part.vertical, 1);
    assert.ok(part.links[0].y > 212 && part.links[0].y < 212.1);
    check("Sloping paths reflect at the bottom and top of the shooter region");

    await setup({ x: 124, y: 44 });
    const enemies = await page.evaluate(() => {
      const a = window.__chainDrive;
      const crawler = a.game.debug("enemy", {
        type: "crawler", x: 239, y: 176, vx: 1, vy: 0,
        dir: 1, speed: 120, phase: 100,
      });
      const drone = a.game.debug("enemy", {
        type: "drone", x: 1, y: 100, dir: -1, speed: 120,
      });
      const ids = { crawler: crawler.id, drone: drone.id };
      a.stepFrames(1);
      return { ids, crawler: a.game.state.crawler, drone: a.game.state.drone };
    });
    assert.equal(enemies.crawler.id, enemies.ids.crawler);
    assert.equal(enemies.drone.id, enemies.ids.drone);
    assert.equal(enemies.crawler.x, 1);
    assert.equal(enemies.drone.x, 239);
    check("Crawler and drone keep their identities while wrapping in opposite directions");

    await setup({ count: 1, x: 237, y: 252, playerX: 2 });
    await frames(1);
    assert.equal((await state()).mode, "dying");
    await setup({ count: 1, x: 237, y: 240, playerX: 2 });
    await page.keyboard.down("Space");
    await frames(1);
    await page.keyboard.up("Space");
    assert.equal((await state()).score, 100);
    assert.equal((await state()).sections.length, 0);
    check("Player contact and upward shots detect enemies across the seam");

    await setup({ count: 5, x: 1, y: 144, playerX: 1 });
    const seam = await page.evaluate(() => {
      const a = window.__chainDrive;
      const c = a.renderer.c;
      const sections = a.game.state.sections;
      const capture = () => c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
      a.game.state.sections = [];
      a.draw();
      const background = capture();
      a.game.state.sections = sections;
      a.draw();
      const drawing = capture();
      let centerChanges = 0;
      let leftChanges = 0;
      let rightChanges = 0;
      for (let y = Math.floor(c.canvas.height * 132 / 256); y < Math.ceil(c.canvas.height * 154 / 256); y++) {
        for (let x = 0; x < c.canvas.width; x++) {
          const i = (y * c.canvas.width + x) * 4;
          if (drawing[i] === background[i] && drawing[i + 1] === background[i + 1] && drawing[i + 2] === background[i + 2]) continue;
          const logicalX = x * 240 / c.canvas.width;
          if (logicalX >= 60 && logicalX < 180) centerChanges++;
          if (logicalX < 12) leftChanges++;
          if (logicalX > 228) rightChanges++;
        }
      }
      return { centerChanges, leftChanges, rightChanges };
    });
    assert.equal(seam.centerChanges, 0, JSON.stringify(seam));
    assert.ok(seam.leftChanges > 10 && seam.rightChanges > 10, JSON.stringify(seam));
    diagnostics.seamPixels = seam;
    await page.screenshot({ path: `${output}/${name}-seam.png` });
    check("A seam-straddling convoy draws at both edges without a connector across the board");

    await frames(3);
    await page.evaluate(() => {
      const a = window.__chainDrive;
      a.draw();
      window.__cylinderFrozen = {
        pixels: a.renderer.canvas.toDataURL(),
        frame: a.game.state.frame,
        time: a.game.state.time,
        phases: JSON.stringify([...a.renderer.treadMotion.links]),
        gears: JSON.stringify([...a.renderer.gearMotion.gears]),
      };
    });
    await page.keyboard.press("KeyP");
    await frames(30);
    const frozen = await page.evaluate(() => {
      const a = window.__chainDrive;
      const before = window.__cylinderFrozen;
      return {
        mode: a.game.state.mode,
        pixels: a.renderer.canvas.toDataURL() === before.pixels,
        frame: a.game.state.frame === before.frame,
        time: a.game.state.time === before.time,
        phases: JSON.stringify([...a.renderer.treadMotion.links]) === before.phases,
        gears: JSON.stringify([...a.renderer.gearMotion.gears]) === before.gears,
        captured: a.input.captured,
        spin: { ...a.input.spin.velocity },
      };
    });
    assert.deepEqual(frozen, {
      mode: "paused", pixels: true, frame: true, time: true,
      phases: true, gears: true, captured: false, spin: { x: 0, y: 0 },
    });
    assert.equal(await page.locator("#variant-picker").isVisible(), false);
    await page.screenshot({ path: `${output}/${name}-paused.png` });
    await page.keyboard.press("Enter");
    assert.equal((await state()).mode, "playing");
    await frames(1);
    assert.equal((await state()).frame, await page.evaluate(() => window.__cylinderFrozen.frame + 1));
    check("Pause preserves exact seam pixels, positions and wheel phases; Enter resumes the same run");

    const mobile = await context.newPage();
    watchErrors(mobile);
    await mobile.setViewportSize({ width: 514, height: 683 });
    await mobile.goto(gameURL("cylinder"));
    await mobile.waitForFunction(
      () => window.__chainDrive?.renderer.backgroundStatus === "ready",
    );
    const layout = await mobile.evaluate(() => {
      const rect = (id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      return {
        picker: rect("variant-picker"),
        start: rect("start-btn"),
        scrollWidth: document.documentElement.scrollWidth,
        width: innerWidth,
        height: innerHeight,
      };
    });
    for (const item of [layout.picker, layout.start]) {
      assert.ok(item.left >= 0 && item.right <= layout.width, JSON.stringify(layout));
      assert.ok(item.top >= 0 && item.bottom <= layout.height, JSON.stringify(layout));
    }
    assert.ok(layout.scrollWidth <= layout.width, JSON.stringify(layout));
    await mobile.screenshot({ path: `${output}/${name}-mobile-title.png` });
    await mobile.locator("#start-btn").click();
    await mobile.evaluate(() => {
      const a = window.__chainDrive;
      a.game.debug("clear");
      a.game.debug("section", { count: 5, x: 1, y: 244, dir: 1 });
      a.game.state.player = { x: 1, y: 252 };
      a.draw();
    });
    await mobile.screenshot({ path: `${output}/${name}-mobile-seam.png` });
    assert.equal(await mobile.evaluate(() => window.__chainDrive.game.state.variant), "cylinder");
    diagnostics.mobile = layout;
    check("The Cylinder picker and start button fit 514×683; seam artwork is captured at laptop-preview size");
    await mobile.close();

    assert.deepEqual(errors, []);
    report.push({ browser: name, version: browser.version(), checks, diagnostics, errors });
  } catch (error) {
    report.push({ browser: name, version: browser.version(), checks, diagnostics, errors, failure: error.stack });
    throw error;
  } finally {
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
    await browser.close();
  }
}
