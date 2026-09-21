// Production input + fixed-step game integration. Synthetic, timestamped mouse
// samples make swipe speed reproducible; native capture has its own browser test.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";

const url = process.env.GAME_URL || "http://localhost:5178";
const output = "output/inertia";
const report = [];
await mkdir(output, { recursive: true });

for (const [name, browserType, options] of [
  ["chrome", chromium, { channel: "chrome" }],
  ["webkit", webkit, {}],
]) {
  let browser;
  const checks = [];
  const errors = [];
  const diagnostics = {};
  const check = (label) => {
    checks.push(label);
    console.log(`${name}: ${label}`);
  };
  try {
    browser = await browserType.launch({ headless: true, ...options });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const state = () =>
      page.evaluate(() => JSON.parse(window.render_game_to_text()));
    const load = async () => {
      await page.goto(`${url}/?test=1&controls=window&seed=4321`);
      await page.waitForFunction(() => window.__chainDrive);
      await page.waitForFunction(
        () => window.__chainDrive.renderer.backgroundStatus === "ready",
      );
      await page.evaluate(() => {
        const api = window.__chainDrive;
        // All movement travels through the real document event listener.
        window.__inertiaFixture = {
          point: null,
          time: 1000,
          send(dx = 0, dy = 0, elapsed = 0) {
            const rect = api.input.canvas.getBoundingClientRect();
            this.time += elapsed;
            this.point ??= {
              x: rect.x + rect.width * 0.4,
              y: rect.y + rect.height * 0.85,
            };
            this.point.x += (dx * rect.width) / 240;
            this.point.y += (dy * rect.height) / 256;
            const event = new MouseEvent("mousemove", {
              bubbles: true,
              clientX: this.point.x,
              clientY: this.point.y,
              movementX: (dx * rect.width) / 240,
              movementY: (dy * rect.height) / 256,
            });
            Object.defineProperty(event, "timeStamp", { value: this.time });
            document.dispatchEvent(event);
          },
          reset(x = 24, y = 228) {
            api.setRealtime(false);
            api.game.start();
            api.game.debug("clear");
            api.game.debug("section", { count: 3, x: 124, y: 44 });
            api.game.state.player = { x, y };
            api.input.clear();
            this.point = null;
            this.time += 2000;
            this.send();
            api.draw();
          },
          swipe({
            distance = 24,
            duration = 40,
            samples = 12,
            axis = "x",
          } = {}) {
            for (let i = 0; i < samples; i++) {
              this.send(
                axis === "x" ? distance / samples : 0,
                axis === "y" ? distance / samples : 0,
                duration / samples,
              );
              window.advanceTime(duration / samples);
            }
          },
          coast(duration = 1000, hz = 60) {
            const count = Math.round((duration * hz) / 1000);
            for (let i = 0; i < count; i++)
              window.advanceTime(duration / count);
            this.time += duration;
          },
        };
      });
    };
    const reset = (x = 24, y = 228) =>
      page.evaluate(({ x, y }) => window.__inertiaFixture.reset(x, y), {
        x,
        y,
      });
    const swipe = (options = {}) =>
      page.evaluate(
        (options) => window.__inertiaFixture.swipe(options),
        options,
      );
    const coast = (duration = 1000, hz = 60) =>
      page.evaluate(
        ({ duration, hz }) => window.__inertiaFixture.coast(duration, hz),
        { duration, hz },
      );
    const velocity = async () =>
      page.evaluate(() => ({ ...window.__chainDrive.input.spin.velocity }));
    const assertStopped = async () => {
      assert.deepEqual(await velocity(), { x: 0, y: 0 });
      const before = (await state()).player;
      await coast(250);
      assert.deepEqual((await state()).player, before);
    };

    await load();
    assert.equal((await state()).controls.sensitivity, 1.5);
    assert.equal(await page.locator("#sensitivity").inputValue(), "1.5");
    assert.equal(
      await page.locator("#sensitivity-output").textContent(),
      "1.50×",
    );
    check(
      "Fresh preferences and the visible sensitivity control default to 1.5×",
    );

    await reset();
    await swipe({ duration: 600 });
    const slowRelease = (await state()).player.x;
    await coast();
    const slowEnd = (await state()).player.x;
    assert.ok(Math.abs(slowEnd - slowRelease) < 0.01);
    assert.ok(slowEnd > 57 && slowEnd < 63);
    check(
      "A slow twenty-four-pixel stroke remains precise and stops without drift",
    );

    await reset();
    await swipe({ distance: 12 });
    const moderateRelease = (await state()).player.x;
    await coast();
    const moderateEnd = (await state()).player.x;
    assert.ok(moderateEnd > moderateRelease + 20);
    diagnostics.moderateSwipe = { moderateRelease, moderateEnd };

    await reset();
    await swipe();
    const fastRelease = (await state()).player.x;
    const fastVelocity = await velocity();
    assert.ok(fastVelocity.x > 100, JSON.stringify(fastVelocity));
    await coast();
    const fastEnd = (await state()).player.x;
    assert.ok(
      fastEnd - fastRelease > 70,
      `Coast was ${fastEnd - fastRelease}px`,
    );
    assert.ok(fastEnd - 24 > (slowEnd - 24) * 3);
    assert.ok(fastEnd < 236, "Measurement must not be clipped by a board edge");
    diagnostics.swipes = {
      slowRelease,
      slowEnd,
      fastRelease,
      fastVelocity,
      fastEnd,
    };
    await page.screenshot({ path: `${output}/${name}-after-flick.png` });
    await coast(2000);
    await assertStopped();
    check(
      "The same quick stroke spins the ball, coasts far without new events, and settles",
    );

    const cadences = [];
    for (const hz of [30, 60, 120]) {
      await reset();
      await swipe();
      // Complete the input tick at 50ms before changing render cadence. This
      // compares the same released ball, with no fresh displacement left to
      // spread differently across a 30Hz catch-up batch.
      await page.evaluate(() => window.advanceTime(10));
      await coast(1000, hz);
      cadences.push({
        hz,
        x: (await state()).player.x,
        velocity: await velocity(),
      });
    }
    diagnostics.cadences = cadences;
    for (const result of cadences) {
      assert.ok(
        Math.abs(result.x - cadences[0].x) < 1e-7,
        JSON.stringify(cadences),
      );
      assert.ok(Math.abs(result.velocity.x - cadences[0].velocity.x) < 1e-7);
    }
    check(
      "An identical flick coasts equally at 30, 60, and 120 Hz render cadence",
    );

    await reset();
    await swipe();
    await coast(100);
    const beforeBrake = (await state()).player.x;
    await swipe({ distance: -0.5, duration: 30, samples: 1 });
    const afterBrake = (await state()).player.x;
    assert.ok(afterBrake < beforeBrake, `${beforeBrake} -> ${afterBrake}`);
    await assertStopped();
    check(
      "A tiny reverse stroke brakes an active spin and responds immediately",
    );

    for (const sign of [1, -1]) {
      await reset(sign > 0 ? 238 : 2);
      await swipe({ distance: sign * 12 });
      await coast(300);
      const wrapped = (await state()).player.x;
      assert.ok(sign > 0 ? wrapped < 120 : wrapped > 120, `coast must cross seam: ${wrapped}`);
      await swipe({ distance: -sign * 0.5, duration: 30, samples: 1 });
      await assertStopped();
    }
    check("Horizontal spin crosses both connected edges; a reverse touch still brakes it");

    await reset(24, 228);
    await page.evaluate(() => {
      window.__chainDrive.game.debug("gear", { col: 10, row: 28, hp: 4 });
    });
    await swipe();
    await coast(1000);
    const stoppedAtGear = (await state()).player.x;
    assert.ok(stoppedAtGear >= 70 && stoppedAtGear < 80, `${stoppedAtGear}`);
    await assertStopped();
    await swipe({ distance: -0.5, duration: 30, samples: 1 });
    assert.ok((await state()).player.x < stoppedAtGear);
    await assertStopped();
    check(
      "Gear collision stops the spin without tunneling or sticky queued movement",
    );

    for (const lifecycle of ["pause", "blur", "death", "resize"]) {
      await reset();
      await swipe();
      assert.ok((await velocity()).x > 100);
      if (lifecycle === "pause") await page.keyboard.press("KeyP");
      if (lifecycle === "blur")
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      if (lifecycle === "death")
        await page.evaluate(() => {
          window.__chainDrive.game.debug("kill");
          window.__chainDrive.draw();
          window.__chainDrive.stepFrames(1);
        });
      if (lifecycle === "resize")
        await page.evaluate(() => window.dispatchEvent(new Event("resize")));
      assert.deepEqual(await velocity(), { x: 0, y: 0 }, lifecycle);
      if (lifecycle === "pause" || lifecycle === "blur") {
        const paused = await state();
        assert.equal(paused.mode, "paused");
        await coast(250);
        assert.equal((await state()).frame, paused.frame);
        assert.deepEqual((await state()).player, paused.player);
        if (lifecycle === "pause")
          await page.screenshot({ path: `${output}/${name}-paused.png` });
        await page.keyboard.press("Enter");
        assert.equal((await state()).mode, "playing");
        await assertStopped();
      } else if (lifecycle === "death") {
        assert.equal((await state()).mode, "dying");
        await coast(2000);
        assert.equal((await state()).mode, "playing");
        await assertStopped();
      } else await assertStopped();
    }
    check(
      "Pause, focus loss, death, and resizing clear spin; resume and respawn stay still",
    );

    await page.locator("#sensitivity").evaluate((element) => {
      element.value = "1.85";
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal((await state()).controls.sensitivity, 1.85);
    await load();
    assert.equal((await state()).controls.sensitivity, 1.85);
    assert.equal(await page.locator("#sensitivity").inputValue(), "1.85");
    check("An explicitly chosen sensitivity persists across reloads");

    assert.deepEqual(errors, []);
    report.push({
      browser: name,
      version: browser.version(),
      checks,
      diagnostics,
      errors,
    });
  } catch (error) {
    report.push({
      browser: name,
      checks,
      diagnostics,
      errors,
      failure: error.stack,
    });
    process.exitCode = 1;
    console.error(`${name}: ${error.stack}`);
  } finally {
    await browser?.close();
  }
}
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
