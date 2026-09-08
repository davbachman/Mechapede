// Controlled Pointer Lock API lifecycle regressions, not native capture tests.
// Real browser capture and physical trackpad feel need separate verification.
import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const url = process.env.GAME_URL || "http://localhost:5178";
const report = [];
await mkdir("output/browser", { recursive: true });

function installControlledPointerLock() {
  let locked = null;
  const api = {
    behavior: "legacy-void",
    requests: [],
    exits: 0,
    grant() {
      locked = document.getElementById("game");
      document.dispatchEvent(new Event("pointerlockchange"));
    },
    release() {
      locked = null;
      document.dispatchEvent(new Event("pointerlockchange"));
    },
  };
  Object.defineProperty(document, "pointerLockElement", {
    configurable: true,
    get: () => locked,
  });
  Element.prototype.requestPointerLock = function () {
    api.requests.push({
      element: this.id,
      eventType: window.event?.type,
      trustedGesture: window.event?.isTrusted === true,
      userActivation: navigator.userActivation?.isActive,
    });
    if (api.behavior === "reject")
      return Promise.reject(
        new DOMException("Controlled capture denial", "NotAllowedError"),
      );
    if (api.behavior === "promise-without-grant") return Promise.resolve();
    // A successful legacy call returns no promise and grants asynchronously.
    return undefined;
  };
  document.exitPointerLock = () => {
    api.exits++;
    locked = null;
    queueMicrotask(() =>
      document.dispatchEvent(new Event("pointerlockchange")),
    );
  };
  window.__controlledPointerLock = api;
}

for (const [name, type, options] of [
  ["chrome", chromium, { channel: "chrome" }],
  ["webkit", webkit, {}],
]) {
  let browser;
  const checks = [];
  const errors = [];
  const check = (label) => {
    checks.push(label);
    console.log(`${name} (controlled API): ${label}`);
  };
  try {
    browser = await type.launch({ headless: true, ...options });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    await context.addInitScript(installControlledPointerLock);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const state = () =>
      page.evaluate(() => JSON.parse(window.render_game_to_text()));
    const frames = (count = 1) =>
      page.evaluate((count) => window.__chainDrive.stepFrames(count), count);
    const grant = () =>
      page.evaluate(() => window.__controlledPointerLock.grant());
    const reset = async () => {
      await page.goto(url + "/?test=1&seed=4321");
      await page.waitForFunction(() => window.__chainDrive);
    };
    const isolate = () =>
      page.evaluate(() => {
        const { game, input, draw } = window.__chainDrive;
        game.debug("clear");
        game.debug("section", { count: 3, x: 124, y: 44 });
        game.state.player = { x: 120, y: 228 };
        input.clear();
        draw();
      });
    const delta = (dx, dy) =>
      page.evaluate(
        ({ dx, dy }) => {
          // Browser-supplied client coordinates remain fixed during pointer lock.
          document.dispatchEvent(
            new MouseEvent("mousemove", {
              bubbles: true,
              clientX: 320,
              clientY: 420,
              movementX: dx,
              movementY: dy,
            }),
          );
          window.__chainDrive.stepFrames(1);
        },
        { dx, dy },
      );
    const heldInputs = async () => {
      await page.keyboard.down("ArrowRight");
      await page.keyboard.down("Space");
      await page.evaluate(() =>
        document
          .getElementById("game")
          .dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              button: 0,
              clientX: 320,
              clientY: 420,
            }),
          ),
      );
      assert.ok((await state()).controls.held.includes("ArrowRight"));
      assert.equal((await state()).controls.pointerFire, true);
    };
    const assertCleared = async () => {
      const s = await state();
      assert.deepEqual(s.controls.held, []);
      assert.equal(s.controls.pointerFire, false);
      assert.deepEqual(
        await page.evaluate(() => {
          const input = window.__chainDrive.input;
          return { dx: input.dx, dy: input.dy, last: input.last };
        }),
        { dx: 0, dy: 0, last: null },
      );
      await page.keyboard.up("ArrowRight");
      await page.keyboard.up("Space");
    };

    await reset();
    assert.equal((await state()).controls.mode, "trackball");
    await page.keyboard.press("Enter");
    let s = await state();
    assert.equal(s.mode, "paused");
    assert.equal(s.controls.captureState, "requesting");
    assert.equal(s.controls.captured, false);
    const firstRequest = await page.evaluate(
      () => window.__controlledPointerLock.requests,
    );
    assert.equal(firstRequest.length, 1);
    assert.equal(firstRequest[0].element, "game");
    assert.equal(firstRequest[0].eventType, "keydown");
    assert.equal(firstRequest[0].trustedGesture, true);
    check(
      "Default Enter requests capture synchronously inside the trusted key gesture",
    );
    await frames(12);
    assert.equal((await state()).frame, s.frame);
    assert.equal(await page.locator("#start-btn").isDisabled(), true);
    assert.equal(await page.locator("#overlay").isVisible(), true);
    check(
      "Legacy void return keeps gameplay paused until pointerlockchange confirms capture",
    );

    await grant();
    assert.equal((await state()).mode, "playing");
    assert.equal((await state()).controls.captureState, "locked");
    assert.equal((await state()).controls.captured, true);
    await isolate();
    await delta(4, -4);
    s = await state();
    assert.ok(s.player.x > 120 && s.player.y < 228);
    const firstPosition = { ...s.player };
    await delta(4, -4);
    s = await state();
    assert.ok(s.player.x > firstPosition.x && s.player.y < firstPosition.y);
    assert.ok(
      Math.abs(s.player.x - firstPosition.x - (firstPosition.x - 120)) < 1e-8,
    );
    assert.ok(
      Math.abs(s.player.y - firstPosition.y - (firstPosition.y - 228)) < 1e-8,
    );
    await frames(6);
    assert.deepEqual((await state()).player, s.player);
    check(
      "Document mousemove uses both movement axes with frozen client coordinates and stops without drift",
    );

    for (const sign of [1, -1]) {
      await isolate();
      await page.evaluate((sign) => {
        for (let i = 0; i < 70; i++) {
          document.dispatchEvent(
            new MouseEvent("mousemove", {
              bubbles: true,
              clientX: 320,
              clientY: 420,
              movementX: sign * 500,
              movementY: sign * 500,
            }),
          );
          window.__chainDrive.stepFrames(1);
        }
      }, sign);
      s = await state();
      assert.deepEqual(
        s.player,
        sign > 0 ? { x: 236, y: 248 } : { x: 4, y: 208 },
      );
      await delta(-sign * 2, -sign * 2);
      const reversed = (await state()).player;
      assert.ok(sign * (reversed.x - s.player.x) < 0);
      assert.ok(sign * (reversed.y - s.player.y) < 0);
      await frames(6);
      assert.deepEqual((await state()).player, reversed);
    }
    check(
      "Repeated large swipes reach all four bounds; tiny reversal responds immediately with no queued motion",
    );

    await heldInputs();
    await page.evaluate(() => {
      const canvas = document.getElementById("game");
      canvas.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseout", { relatedTarget: null }),
      );
    });
    assert.equal((await state()).mode, "playing");
    assert.equal((await state()).controls.captured, true);
    assert.equal((await state()).controls.pointerFire, true);
    check(
      "Canvas and window mouseout preserve locked gameplay and held firing",
    );

    await page.keyboard.press("Escape");
    assert.equal((await state()).mode, "paused");
    assert.equal((await state()).controls.captured, false);
    await assertCleared();
    check(
      "Escape releases capture, pauses, and clears held keys, fire, and deltas",
    );
    const requestsBeforeResume = await page.evaluate(
      () => window.__controlledPointerLock.requests.length,
    );
    await page.locator("#start-btn").click();
    assert.equal((await state()).mode, "paused");
    const resumeRequests = await page.evaluate(
      () => window.__controlledPointerLock.requests,
    );
    assert.equal(resumeRequests.length, requestsBeforeResume + 1);
    assert.equal(resumeRequests.at(-1).eventType, "click");
    assert.equal(resumeRequests.at(-1).trustedGesture, true);
    await grant();
    assert.equal((await state()).mode, "playing");
    const resumedPosition = (await state()).player;
    await frames(3);
    assert.deepEqual((await state()).player, resumedPosition);
    check(
      "Deliberate Resume clicks synchronously request fresh capture and resume only after confirmation",
    );

    await heldInputs();
    await page.evaluate(() => dispatchEvent(new Event("blur")));
    assert.equal((await state()).mode, "paused");
    assert.equal((await state()).controls.captured, false);
    await assertCleared();
    await page.evaluate(() => dispatchEvent(new Event("focus")));
    await frames(3);
    assert.equal((await state()).mode, "paused");
    check(
      "Focus loss releases capture and clears input; returning focus does not resume",
    );

    await page.keyboard.press("Enter");
    await grant();
    await heldInputs();
    await page.evaluate(() => window.__controlledPointerLock.release());
    assert.equal((await state()).mode, "paused");
    await assertCleared();
    check("Browser-originated capture loss pauses and clears input");

    await reset();
    await page.evaluate(() => {
      window.__controlledPointerLock.behavior = "promise-without-grant";
    });
    await page.locator("#start-btn").click();
    await frames(3);
    assert.equal((await state()).mode, "paused");
    assert.equal((await state()).controls.captureState, "requesting");
    await grant();
    assert.equal((await state()).mode, "playing");
    check("Fulfilled request promise alone does not claim capture or resume");

    await reset();
    await page.evaluate(() => {
      window.__controlledPointerLock.behavior = "reject";
    });
    await page.locator("#start-btn").click();
    await page.waitForFunction(
      () =>
        JSON.parse(window.render_game_to_text()).controls.captureState ===
        "blocked",
    );
    s = await state();
    assert.equal(s.mode, "paused");
    assert.equal(s.controls.captured, false);
    assert.match(s.controls.captureError, /Controlled capture denial/);
    await frames(12);
    assert.equal((await state()).frame, s.frame);
    assert.equal(await page.locator("#start-btn").isEnabled(), true);
    await page.screenshot({
      path: `output/browser/${name}-trackball-controlled-denied.png`,
    });
    check("Rejected capture remains blocked and paused with a usable retry");
    await page.locator("#window-controls-btn").click();
    assert.equal((await state()).controls.mode, "window");
    assert.equal((await state()).mode, "playing");
    assert.equal((await state()).controls.captured, false);
    await isolate();
    await page.keyboard.down("ArrowRight");
    await frames(2);
    await page.keyboard.up("ArrowRight");
    assert.ok((await state()).player.x > 120);
    check(
      "Explicit window/keyboard fallback starts playable controls after denial",
    );

    await page.evaluate(() =>
      localStorage.removeItem("chain-drive.control-mode"),
    );
    await reset();
    await page.keyboard.press("Enter");
    assert.equal((await state()).controls.captureState, "requesting");
    await page.keyboard.press("Escape");
    await grant();
    assert.equal((await state()).mode, "paused");
    assert.equal((await state()).controls.captured, false);
    assert.equal((await state()).controls.captureState, "idle");
    assert.ok(
      await page.evaluate(() => window.__controlledPointerLock.exits > 0),
    );
    await frames(3);
    assert.equal((await state()).mode, "paused");
    check(
      "A late lock grant after Escape is released without resuming canceled gameplay",
    );

    assert.deepEqual(errors, []);
    check("No runtime or console errors");
    report.push({
      browser: name,
      method: "controlled Pointer Lock API",
      checks,
    });
  } catch (error) {
    report.push({
      browser: name,
      method: "controlled Pointer Lock API",
      checks,
      error: error.stack,
      consoleErrors: errors,
    });
    process.exitCode = 1;
    console.error(`${name} (controlled API) failed:`, error);
  } finally {
    await browser?.close();
  }
}

await writeFile(
  "output/browser/trackball-controlled-report.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    report.map(({ browser, checks, error }) => ({
      browser,
      passed: checks.length,
      failed: !!error,
    })),
    null,
    2,
  ),
);
