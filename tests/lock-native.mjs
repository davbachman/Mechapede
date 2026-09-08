import { chromium } from "playwright";
import assert from "node:assert/strict";

// Run alone with Chrome as the foreground macOS app. Native pointer lock needs a
// key NSWindow; document.hasFocus() and Playwright bringToFront() alone do not.
const browser = await chromium.launch({ channel: "chrome", headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const failures = [];
page.on("pageerror", (error) => failures.push(error.message));
const state = () =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const step = () => page.evaluate(() => window.__chainDrive.stepFrames(1));
const results = [];
try {
  await page.goto("http://localhost:5178/?test=1&seed=4321");
  await page.waitForFunction(() => window.__chainDrive);
  await page.bringToFront();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      document.pointerLockElement === document.querySelector("canvas") &&
      window.__chainDrive.game.state.mode === "playing",
    null,
    { timeout: 3000 },
  );
  assert.equal((await state()).mode, "playing");
  results.push("Enter acquires actual Chrome pointer lock before play");
  await page.evaluate(() => {
    const a = window.__chainDrive;
    a.game.debug("clear");
    a.game.debug("section", { count: 3, x: 124, y: 44 });
    a.game.state.player = { x: 120, y: 240 };
    window.nativeMotion = [];
    document.addEventListener("mousemove", (e) =>
      window.nativeMotion.push({
        x: e.clientX,
        y: e.clientY,
        dx: e.movementX,
        dy: e.movementY,
        trusted: e.isTrusted,
      }),
    );
  });
  await page.mouse.move(640, 400);
  await step();
  for (let x = 650; x <= 3500; x += 50) {
    await page.mouse.move(x, 400);
    await step();
  }
  const farRight = await state();
  const motions = await page.evaluate(() => window.nativeMotion);
  assert.equal(farRight.controls.captured, true);
  assert.equal(farRight.player.x, 236);
  assert.ok(motions.some((e) => e.trusted && e.dx > 0));
  results.push(
    "Trusted Chrome mousemove deltas keep controlling beyond window coordinates",
  );
  await page.mouse.move(3485, 390);
  await step();
  const reversed = await state();
  assert.ok(reversed.player.x < 236, JSON.stringify(reversed.player));
  assert.ok(
    reversed.player.y < farRight.player.y,
    JSON.stringify(reversed.player),
  );
  results.push(
    "Direction reversal moves immediately in both axes after overshooting",
  );
  const still = { ...reversed.player };
  for (let i = 0; i < 5; i++) await step();
  assert.deepEqual((await state()).player, still);
  results.push("No movement or accumulated overshoot after motion stops");
  await page.keyboard.down("Space");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.pointerLockElement);
  const released = await state();
  assert.equal(released.mode, "paused");
  assert.deepEqual(released.controls.held, []);
  assert.equal(released.controls.pointerFire, false);
  await page.keyboard.up("Space");
  results.push("Escape releases actual lock, pauses, and clears held input");
  await page.waitForTimeout(1600);
  await page.locator("#start-btn").click();
  await page.waitForFunction(
    () =>
      document.pointerLockElement === document.querySelector("canvas") &&
      window.__chainDrive.game.state.mode === "playing",
    null,
    { timeout: 3000 },
  );
  assert.equal((await state()).mode, "playing");
  results.push("Resume click reacquires actual lock");
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify({ passed: results, lastMotion: motions.slice(-5) }),
  );
} finally {
  await browser.close();
}
