import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const url = process.env.GAME_URL || "http://localhost:5178";
await mkdir("output/browser", { recursive: true });
const report = [];
for (const [requestedName, type, options] of [
  ["chrome", chromium, { channel: "chrome" }],
  ["webkit", webkit, {}],
]) {
  let browser,
    name = requestedName;
  try {
    browser = await type.launch({ headless: true, ...options });
  } catch (error) {
    if (name === "chrome") {
      try {
        browser = await chromium.launch({ headless: true });
        name = "chromium";
      } catch (fallbackError) {
        report.push({ browser: name, unavailable: fallbackError.message });
        continue;
      }
    } else {
      report.push({ browser: name, unavailable: error.message });
      continue;
    }
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const checks = [];
  const check = (name) => {
    checks.push(name);
    console.log(type.name() + ": " + name);
  };
  const state = () =>
    page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const frames = (n) =>
    page.evaluate((n) => window.__chainDrive.stepFrames(n), n);
  const isolated = () =>
    page.evaluate(() => {
      const { game } = window.__chainDrive;
      game.start();
      game.debug("clear");
      game.debug("section", { count: 3, x: 124, y: 44 });
      game.state.player = { x: 120, y: 240 };
      window.__chainDrive.draw();
    });
  try {
    await page.goto(url + "/?test=1&controls=window&seed=4321");
    await page.waitForFunction(() => window.__chainDrive);
    assert.equal((await state()).mode, "title");
    await page.screenshot({ path: `output/browser/${name}-title.png` });
    await page.keyboard.press("Enter");
    assert.equal((await state()).mode, "playing");
    await frames(4);
    assert.equal((await state()).sections[0].links.length, 12);
    check("Enter starts twelve-link arcade wave");
    await page.waitForFunction(
      () => window.__chainDrive.audio.context?.state === "running",
    );
    check("User gesture activates Web Audio");
    await isolated();
    let box = await page.locator("canvas").boundingBox();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.8);
    await page.mouse.move(
      box.x + box.width * 0.405,
      box.y + box.height * 0.795,
    );
    await frames(1);
    let s = await state();
    assert.ok(s.player.x > 120 && s.player.y < 240);
    const pos = { ...s.player };
    await frames(5);
    assert.deepEqual((await state()).player, pos);
    check("Relative two-axis pointer movement; stops without drift");
    await page.keyboard.down("Space");
    await page.mouse.move(box.x + box.width * 0.415, box.y + box.height * 0.79);
    await frames(1);
    s = await state();
    assert.ok(s.bullet);
    assert.ok(s.player.x > pos.x);
    await page.keyboard.up("Space");
    assert.equal(await page.evaluate(() => scrollY), 0);
    check("Fire while moving; Space does not scroll");
    await page.mouse.down();
    await frames(40);
    assert.equal((await state()).controls.pointerFire, true);
    await page.mouse.up();
    assert.equal((await state()).controls.pointerFire, false);
    check("Primary button hold/release fires");
    await page.keyboard.press("KeyP");
    assert.equal((await state()).mode, "paused");
    s = await state();
    await frames(40);
    assert.equal((await state()).frame, s.frame);
    assert.equal((await state()).controls.held.length, 0);
    await page.screenshot({ path: `output/browser/${name}-pause.png` });
    await page.keyboard.press("Enter");
    assert.equal((await state()).mode, "playing");
    check("Pause freezes state and deliberate Enter resumes");
    await page.locator("#pause-button").click({ delay: 120 });
    assert.equal((await state()).mode, "paused");
    await page.keyboard.press("KeyP");
    assert.equal((await state()).mode, "playing");
    check("P resumes even when the pause button retains focus");
    await page.keyboard.press("KeyF");
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => !!document.fullscreenElement), true);
    await page.keyboard.press("KeyF");
    check("Fullscreen toggles and preserves play");
    await isolated();
    await page.keyboard.down("ArrowLeft");
    await page.keyboard.down("Space");
    await frames(5);
    await page.evaluate(() => dispatchEvent(new Event("blur")));
    assert.equal((await state()).mode, "paused");
    assert.deepEqual((await state()).controls.held, []);
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.up("Space");
    await page.keyboard.press("Enter");
    let afterResume = (await state()).player;
    await frames(4);
    assert.deepEqual((await state()).player, afterResume);
    check("Focus loss pauses and clears held movement/fire");
    await isolated();
    box = await page.locator("canvas").boundingBox();
    await page.mouse.move(box.x + 2, box.y + box.height * 0.8);
    await frames(1);
    await page.mouse.down();
    await page.mouse.move(box.x - 10, box.y + box.height * 0.8);
    await frames(1);
    const outsideX = (await state()).player.x;
    await page.mouse.move(box.x - 14, box.y + box.height * 0.8);
    await frames(1);
    assert.ok((await state()).player.x < outsideX);
    assert.equal((await state()).controls.pointerFire, true);
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.body).cursor),
      "none",
    );
    check(
      "Movement and held firing continue outside the game rectangle; cursor stays hidden",
    );
    await page.mouse.up();
    await page.evaluate(() =>
      document.dispatchEvent(
        new MouseEvent("mouseout", { relatedTarget: null }),
      ),
    );
    assert.equal((await state()).mode, "paused");
    assert.equal((await state()).controls.pointerFire, false);
    await page.keyboard.press("Enter");
    const entered = (await state()).player;
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8);
    await frames(1);
    assert.deepEqual((await state()).player, entered);
    check(
      "Window exit pauses and reentry after deliberate resume does not jump",
    );
    await isolated();
    await page.keyboard.down("KeyA");
    await page.keyboard.down("KeyW");
    await frames(2);
    await page.keyboard.up("KeyA");
    await page.keyboard.up("KeyW");
    assert.ok((await state()).player.x < 120 && (await state()).player.y < 240);
    check("WASD fallback supports simultaneous axes");
    await page.keyboard.press("KeyP");
    await page.locator("#sensitivity").evaluate((e) => {
      e.value = "1.5";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator("#volume").evaluate((e) => {
      e.value = "30";
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.keyboard.press("KeyM");
    assert.equal((await state()).audio.muted, true);
    await page.reload();
    await page.waitForFunction(() => window.__chainDrive);
    assert.equal((await state()).controls.sensitivity, 1.5);
    assert.equal((await state()).audio.volume, 0.3);
    assert.equal((await state()).audio.muted, true);
    check("Sensitivity, volume, mute persist across reload");
    await page.keyboard.press("Enter");
    await page.keyboard.press("KeyM");
    await isolated();
    box = await page.locator("canvas").boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8);
    await page.mouse.move(box.x + box.width * 0.504, box.y + box.height * 0.8);
    await frames(1);
    const delta = (await state()).player.x - 120;
    assert.ok(
      Math.abs(delta - 1.44) < 0.65,
      `pointer delta ${delta}; tolerance allows native CSS-pixel rounding`,
    );
    check("Sensitivity scales logical pointer deltas");
    await page.setViewportSize({ width: 1100, height: 720 });
    await page.waitForTimeout(50);
    await isolated();
    box = await page.locator("canvas").boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8);
    await page.mouse.move(box.x + box.width * 0.504, box.y + box.height * 0.8);
    await frames(1);
    assert.ok(Math.abs((await state()).player.x - 120 - delta) < 0.75);
    assert.ok(Math.abs(box.width / box.height - 3 / 4) < 0.002);
    check("Laptop resize preserves field aspect and logical input scaling");
    await page.evaluate(() => {
      window.__chainDrive.game.debug("scenario", { name: "crowded" });
      window.__chainDrive.draw();
    });
    await page.screenshot({ path: `output/browser/${name}-crowded.png` });
    await frames(4);
    s = await state();
    assert.ok(s.sections.length >= 5);
    assert.ok(s.sections.every((p) => p.links[0].leader));
    check("Crowded lower region renders independent active heads");
    await page.evaluate(() => {
      window.__chainDrive.game.debug("scenario", { name: "split" });
      window.__chainDrive.game.debug("hitLink", { index: 3 });
      window.__chainDrive.draw();
    });
    s = await state();
    assert.equal(s.sections.flatMap((p) => p.links).length, 7);
    assert.equal(s.sections.length, 2);
    assert.ok(s.sections.every((p) => p.links[0].leader));
    await page.screenshot({ path: `output/browser/${name}-split.png` });
    check("Middle hit preserves identities/count and activates rear head");
    await page.evaluate(() => {
      window.__chainDrive.game.debug("scenario", { name: "enemies" });
      window.__chainDrive.draw();
    });
    await frames(4);
    await page.screenshot({ path: `output/browser/${name}-enemies.png` });
    check("Mechanical supporting cast renders with mounted/electrified gears");
    await isolated();
    await page.evaluate(() => {
      const g = window.__chainDrive.game;
      while (g.state.sections.length)
        g.debug("hitLink", { section: 0, index: 0 });
    });
    await frames(1);
    assert.equal((await state()).mode, "wave");
    await frames(100);
    assert.equal((await state()).wave, 2);
    assert.equal((await state()).mode, "playing");
    check("Eliminating all links advances wave");
    await isolated();
    await page.evaluate(() => {
      const g = window.__chainDrive.game;
      g.state.sections = [];
    });
    await frames(1);
    await page.keyboard.down("Space");
    await page.keyboard.down("ArrowRight");
    const waveX = (await state()).player.x;
    await frames(2);
    assert.equal((await state()).mode, "wave");
    assert.ok((await state()).player.x > waveX);
    assert.ok((await state()).bullet);
    await page.keyboard.up("Space");
    await page.keyboard.up("ArrowRight");
    await frames(100);
    check("Player can move and fire during original interwave interval");
    const timing = await page.evaluate(() =>
      [30, 60, 120].map((fps) => {
        const api = window.__chainDrive;
        api.setRealtime(false);
        api.input.clear();
        api.game.start();
        api.game.debug("clear");
        api.game.debug("section", { count: 5, x: 124, y: 44 });
        api.game.state.player = { x: 20, y: 240 };
        for (let f = 0; f < fps / 2; f++) {
          api.input.dx += 240 / fps;
          window.advanceTime(1000 / fps);
        }
        return {
          player: api.game.state.player,
          frame: api.game.state.frame,
          head: api.game.state.sections[0].links[0],
        };
      }),
    );
    assert.deepEqual(timing[0], timing[1]);
    assert.deepEqual(timing[1], timing[2]);
    check(
      "Buffered pointer motion and simulation agree at 30/60/120 render Hz",
    );
    await page.evaluate(() => {
      const g = window.__chainDrive.game;
      g.debug("score", { points: 12000 - g.state.score });
    });
    assert.equal((await state()).lives, 4);
    await frames(1);
    check("Scoring awards extra tool at 12,000");
    await page.evaluate(() => window.__chainDrive.game.debug("kill"));
    assert.equal((await state()).mode, "dying");
    await page.evaluate(() => {
      for (
        let n = 0;
        n < 1000 && window.__chainDrive.game.state.mode === "dying";
        n++
      )
        window.__chainDrive.stepFrames(1);
    });
    assert.equal((await state()).mode, "playing");
    assert.equal((await state()).lives, 3);
    check("Death repairs field and restarts life");
    await page.evaluate(() => {
      const g = window.__chainDrive.game;
      g.state.lives = 1;
      g.debug("kill");
    });
    await frames(300);
    assert.equal((await state()).mode, "gameover");
    await page.screenshot({ path: `output/browser/${name}-gameover.png` });
    await page.keyboard.press("Enter");
    assert.equal((await state()).mode, "playing");
    assert.equal((await state()).score, 0);
    assert.equal((await state()).lives, 3);
    check("Game over and new-game restart; score reset");
    await page.reload();
    await page.waitForFunction(() => window.__chainDrive);
    assert.ok(Number(await page.locator("#high-score").textContent()) >= 12000);
    check("High score persists");
    await page.keyboard.press("Enter");
    await page.locator("#capture-button").click();
    await page.waitForTimeout(150);
    const captured = await page.evaluate(
      () => document.pointerLockElement === document.querySelector("canvas"),
    );
    if (captured) {
      await page.evaluate(() => document.exitPointerLock());
      await page.waitForTimeout(50);
      assert.equal((await state()).mode, "paused");
      check("Optional pointer capture releases and pauses");
    } else {
      assert.equal((await state()).mode, "paused");
      assert.equal((await state()).controls.captureState, "blocked");
      assert.ok(await page.locator("#window-controls-btn").isVisible());
      await page.locator("#window-controls-btn").click();
      assert.equal((await state()).mode, "playing");
      check(
        "Blocked capture explains the limitation and offers an explicit playable fallback",
      );
    }
    await page.reload();
    await page.waitForFunction(() => window.__chainDrive);
    await page.keyboard.press("Enter");
    await page.evaluate(() => window.__chainDrive.setRealtime(true));
    await page.keyboard.down("Space");
    await page.waitForTimeout(1300);
    await page.keyboard.up("Space");
    assert.ok((await state()).frame >= 45);
    check("Real-time animation loop advances gameplay and shooting");
    await page.reload();
    await page.waitForFunction(() => window.__chainDrive);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.keyboard.press("Enter");
    await frames(500);
    await page.screenshot({ path: `output/browser/${name}-playing.png` });
    const standardContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const standardPage = await standardContext.newPage();
    await standardPage.goto(url + "/?test=1&controls=window&seed=12345");
    await standardPage.waitForFunction(() => window.__chainDrive);
    await standardPage.keyboard.press("Enter");
    await standardPage.evaluate(() => {
      const a = window.__chainDrive;
      a.game.debug("clear");
      a.game.debug("section", { count: 3, x: 124, y: 44 });
      a.game.state.player = { x: 120, y: 240 };
      a.draw();
    });
    const standardBox = await standardPage.locator("canvas").boundingBox();
    await standardPage.mouse.move(
      standardBox.x + standardBox.width * 0.5,
      standardBox.y + standardBox.height * 0.8,
    );
    await standardPage.mouse.move(
      standardBox.x + standardBox.width * 0.508,
      standardBox.y + standardBox.height * 0.8,
    );
    await standardPage.evaluate(() => window.__chainDrive.stepFrames(1));
    const standardResult = await standardPage.evaluate(() => ({
      x: window.__chainDrive.game.state.player.x,
      dpr: devicePixelRatio,
      backing: document.querySelector("canvas").width,
    }));
    assert.ok(Math.abs(standardResult.x - (120 + 1.92 * 1.5)) < 0.7);
    assert.equal(standardResult.dpr, 1);
    assert.ok(Math.abs(standardResult.backing - standardBox.width) < 1);
    await standardPage.screenshot({
      path: `output/browser/${name}-1280-dpr1.png`,
    });
    await standardContext.close();
    check("Standard-density laptop display preserves logical pointer scaling");
    assert.deepEqual(errors, []);
    check("No uncaught runtime/console errors across all flows");
    report.push({ browser: name, version: browser.version(), checks, errors });
  } catch (error) {
    report.push({
      browser: name,
      version: browser.version(),
      checks,
      errors,
      failure: error.stack,
      state: await state(),
    });
    console.error(error);
    await page.screenshot({ path: `output/browser/${name}-failure.png` });
  }
  await browser.close();
}
await writeFile("output/browser/report.json", JSON.stringify(report, null, 2));
if (
  report.some((r) => r.failure || r.unavailable) ||
  !report.some((r) => r.checks?.length)
)
  process.exitCode = 1;
console.log(
  JSON.stringify(
    report.map(({ browser, version, checks, failure, unavailable }) => ({
      browser,
      version,
      checks: checks?.length,
      failure,
      unavailable,
    })),
    null,
    2,
  ),
);
