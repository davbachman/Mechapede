import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const output = "output/treads";
const url = process.env.GAME_URL || "http://localhost:5178";
await mkdir(output, { recursive: true });
const reports = [];

for (const [name, type, options] of [
  ["chrome", chromium, { channel: "chrome" }],
  ["webkit", webkit, {}],
]) {
  const browser = await type.launch({ headless: true, ...options });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  const checks = [];
  const check = (description) => {
    checks.push(description);
    console.log(`${name}: ${description}`);
  };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const screenshot = async (label, detail = false) => {
    await page.screenshot({ path: `${output}/${name}-${label}.png` });
    if (!detail) return;
    const box = await page.locator("canvas").boundingBox();
    await page.screenshot({
      path: `${output}/${name}-${label}-detail.png`,
      clip: {
        x: box.x + (box.width * 25) / 240,
        y: box.y + (box.height * 72) / 256,
        width: (box.width * 142) / 240,
        height: (box.height * 42) / 256,
      },
    });
  };
  const probe = () => page.evaluate(() => window.__treadProbe());
  const round = (units) => {
    assert.ok(units.length > 0);
    for (const unit of units) {
      assert.ok(
        unit.circles.length >= 2,
        "Each unit renders circular wheel detail",
      );
      for (const circle of unit.circles) {
        assert.ok(
          Math.abs(circle.scaleX / circle.scaleY - 1) < 0.00001,
          `Unit ${unit.id}: screen axes must have equal scale`,
        );
        assert.ok(
          Math.abs(circle.skew) < 0.00001,
          `Unit ${unit.id}: circular axes must remain perpendicular`,
        );
      }
    }
  };

  try {
    await page.goto(`${url}/?test=1&controls=window&seed=4321`);
    await page.waitForFunction(
      () => window.__chainDrive?.renderer.backgroundStatus === "ready",
    );
    await page.keyboard.press("Enter");
    await page.evaluate(() => {
      // Observe the production drawing calls, including their full canvas and
      // CSS transforms. This verifies that wheel rotation reaches the artwork,
      // not just the renderer's stored phase values.
      window.__treadProbe = () => {
        const { renderer, game } = window.__chainDrive;
        const c = renderer.c;
        const canvas = renderer.canvas;
        const box = canvas.getBoundingClientRect();
        const cssX = box.width / canvas.width;
        const cssY = box.height / canvas.height;
        const originalUnit = renderer.trackedUnit;
        const originalArc = c.arc;
        const units = [];
        let current = null;
        renderer.trackedUnit = function (link, ...args) {
          current = {
            id: link.id,
            travel: this.treadMotion.travel(link),
            circles: [],
          };
          units.push(current);
          try {
            return originalUnit.call(this, link, ...args);
          } finally {
            current = null;
          }
        };
        c.arc = function (...args) {
          if (current) {
            const m = this.getTransform();
            const ax = m.a * cssX,
              ay = m.b * cssY;
            const bx = m.c * cssX,
              by = m.d * cssY;
            const scaleX = Math.hypot(ax, ay);
            const scaleY = Math.hypot(bx, by);
            current.circles.push({
              scaleX,
              scaleY,
              skew: (ax * bx + ay * by) / (scaleX * scaleY),
              angle: Math.atan2(ay, ax),
            });
          }
          return originalArc.apply(this, args);
        };
        try {
          renderer.draw(game.state, 0);
          return units;
        } finally {
          renderer.trackedUnit = originalUnit;
          c.arc = originalArc;
        }
      };
      window.__treadSetup = (obstacle = false) => {
        const a = window.__chainDrive;
        a.game.start();
        a.game.debug("clear");
        a.game.debug("section", {
          count: 12,
          x: obstacle ? 100 : 132,
          y: 84,
          dir: 1,
        });
        if (obstacle) a.game.debug("gear", { col: 16, row: 10 });
        a.draw();
      };
      window.__treadSetup();
    });
    const initial = await probe();
    assert.equal(initial.length, 12);
    round(initial);
    await screenshot("straight", true);
    await page.evaluate(() => window.__chainDrive.stepFrames(2));
    const moving = await probe();
    assert.equal(moving.length, 12);
    for (const unit of moving) {
      const before = initial.find((u) => u.id === unit.id);
      assert.ok(
        unit.travel > before.travel,
        `Unit ${unit.id} advances its tread`,
      );
      assert.ok(
        unit.circles.some(
          (circle, i) =>
            Math.abs(circle.angle - before.circles[i].angle) > 0.001,
        ),
        `Unit ${unit.id} physically rotates its rendered wheels`,
      );
    }
    check(
      "All twelve moving units, including followers, rotate rendered gears",
    );
    await screenshot("moving", true);

    const redraw = await page.evaluate(() => {
      const a = window.__chainDrive;
      const state = JSON.stringify(a.game.state);
      const before = JSON.stringify(window.__treadProbe());
      for (let n = 0; n < 5; n++) a.renderer.draw(a.game.state, 0);
      return {
        sameState: state === JSON.stringify(a.game.state),
        sameDrawing: before === JSON.stringify(window.__treadProbe()),
      };
    });
    assert.deepEqual(redraw, { sameState: true, sameDrawing: true });
    check(
      "Repeated draws preserve gameplay, tread phase, and wheel orientation",
    );

    // Compare actual canvas bytes across the user's P pause action. The Resume
    // control is a separate DOM overlay and must not replace the frozen board.
    await page.evaluate(() => {
      const a = window.__chainDrive;
      a.draw();
      const c = a.renderer.c;
      window.__frozenTreadPixels = c.getImageData(
        0,
        0,
        c.canvas.width,
        c.canvas.height,
      ).data;
      window.__frozenTreadState = {
        frame: a.game.state.frame,
        time: a.game.state.time,
        drawing: JSON.stringify(window.__treadProbe()),
      };
    });
    await page.keyboard.press("KeyP");
    const pause = await page.evaluate(() => {
      const a = window.__chainDrive;
      for (let n = 0; n < 30; n++) a.stepFrames(1);
      const c = a.renderer.c;
      const pixels = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
      return {
        mode: a.game.state.mode,
        samePixels: pixels.every(
          (value, i) => value === window.__frozenTreadPixels[i],
        ),
        sameFrame: a.game.state.frame === window.__frozenTreadState.frame,
        sameTime: a.game.state.time === window.__frozenTreadState.time,
        sameDrawing:
          JSON.stringify(window.__treadProbe()) ===
          window.__frozenTreadState.drawing,
        captured: a.input.captured,
      };
    });
    assert.deepEqual(pause, {
      mode: "paused",
      samePixels: true,
      sameFrame: true,
      sameTime: true,
      sameDrawing: true,
      captured: false,
    });
    check(
      "P releases pointer control and freezes every canvas pixel and moving part",
    );
    await screenshot("pause");
    await page.keyboard.press("Enter");
    await page.evaluate(() => window.__chainDrive.stepFrames(1));
    assert.ok(
      (await probe()).every(
        (u) => u.travel > moving.find((m) => m.id === u.id).travel,
      ),
    );
    check("Resume continues the existing tread phases");

    const split = await page.evaluate(() => {
      const a = window.__chainDrive;
      const links = a.game.state.sections[0].links;
      const removedId = links[3].id;
      const promotedId = links[4].id;
      const phases = Object.fromEntries(
        links.map((l) => [l.id, a.renderer.treadMotion.travel(l)]),
      );
      a.game.debug("hitLink", { section: 0, index: 3 });
      a.draw();
      return {
        removedId,
        promotedId,
        phases,
        sections: a.game.state.sections.map((s) =>
          s.links.map((l) => ({
            id: l.id,
            leader: l.leader,
            travel: a.renderer.treadMotion.travel(l),
          })),
        ),
      };
    });
    assert.equal(split.sections.length, 2);
    const surviving = split.sections.flat();
    assert.equal(surviving.length, 11);
    assert.ok(surviving.every((l) => l.id !== split.removedId));
    assert.ok(surviving.every((l) => l.travel === split.phases[l.id]));
    assert.ok(split.sections.every((s) => s[0].leader));
    assert.ok(split.sections.some((s) => s[0].id === split.promotedId));
    round(await probe());
    check(
      "Middle hit preserves eleven unit identities and phases; rear unit becomes active",
    );
    await screenshot("split", true);

    await page.evaluate(() => window.__treadSetup(true));
    let turningFrames = 0;
    let capturedTurn = false;
    for (let n = 0; n < 45; n++) {
      const result = await page.evaluate(() => {
        const a = window.__chainDrive;
        a.stepFrames(1);
        return {
          turning: a.game.state.sections[0].links.filter((l) => l.turning)
            .length,
          units: window.__treadProbe(),
        };
      });
      round(result.units);
      if (result.turning) turningFrames++;
      if (result.turning && n >= 14 && !capturedTurn) {
        await screenshot("turn", true);
        capturedTurn = true;
      }
    }
    assert.ok(turningFrames > 10);
    assert.ok(capturedTurn);
    check("Drive gears remain round across actual obstacle turns");

    await page.setViewportSize({ width: 514, height: 683 });
    await page.waitForTimeout(50);
    await page.evaluate(() => window.__chainDrive.draw());
    round(await probe());
    const narrow = await page.locator("canvas").boundingBox();
    assert.ok(Math.abs(narrow.y) < 1);
    assert.ok(Math.abs(narrow.width / narrow.height - 0.75) < 0.001);
    await screenshot("narrow");
    check(
      "Narrow layout keeps round gears, original board aspect, and top-edge fit",
    );
    assert.deepEqual(errors, []);
    check("No browser runtime or console errors");
    reports.push({
      browser: name,
      version: browser.version(),
      checks,
      turningFrames,
      errors,
    });
  } catch (error) {
    await screenshot("failure");
    reports.push({
      browser: name,
      version: browser.version(),
      checks,
      failure: error.stack,
      errors,
    });
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await writeFile(`${output}/report.json`, JSON.stringify(reports, null, 2));
console.log(
  reports.map(({ browser, checks, failure }) => ({
    browser,
    checks: checks.length,
    failure,
  })),
);
