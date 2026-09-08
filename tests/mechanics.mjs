import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const output = "output/mechanics";
await mkdir(output, { recursive: true });
const reports = [];
for (const [name, type, launch] of [
  ["chrome", chromium, { channel: "chrome" }],
  ["webkit", webkit, {}],
]) {
  const browser = await type.launch({ headless: true, ...launch });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await page.goto("http://localhost:5178/?test=1&controls=window&seed=4321");
    await page.waitForFunction(() => window.__chainDrive);
    await page.keyboard.press("Enter");
    const setup = async (x = 100) =>
      page.evaluate((x) => {
        const a = window.__chainDrive;
        a.game.start();
        a.game.debug("clear");
        a.game.debug("section", { count: 12, x, y: 84, dir: 1 });
        a.game.debug("gear", { col: 16, row: 10 });
        for (let hp = 1; hp <= 4; hp++) {
          a.game.debug("gear", { col: 8 + hp * 3, row: 19, hp });
          a.game.debug("gear", {
            col: 8 + hp * 3,
            row: 22,
            hp,
            electrified: true,
          });
        }
        a.draw();
      }, x);
    await setup();
    await page.screenshot({ path: `${output}/${name}-straight.png` });
    const samples = [];
    for (let n = 0; n < 60; n++) {
      samples.push(
        await page.evaluate(() => {
          const a = window.__chainDrive;
          a.stepFrames(1);
          const gear = a.game.state.gears[0];
          const snapshot = JSON.stringify(a.game.state);
          const angle = a.renderer.gearMotion.angle(gear);
          a.renderer.draw(a.game.state, 0);
          return {
            frame: a.game.state.frame,
            angle,
            sameState: snapshot === JSON.stringify(a.game.state),
            sameAngle: angle === a.renderer.gearMotion.angle(gear),
            head: a.game.state.sections[0].links[0],
          };
        }),
      );
      if ([11, 12, 15, 16, 28].includes(n)) {
        await page.screenshot({ path: `${output}/${name}-turn-${n}.png` });
        const box = await page.locator("canvas").boundingBox();
        await page.screenshot({
          path: `${output}/${name}-detail-${n}.png`,
          clip: {
            x: box.x + (box.width * 50) / 240,
            y: box.y + (box.height * 70) / 256,
            width: (box.width * 100) / 240,
            height: (box.height * 38) / 256,
          },
        });
      }
    }
    assert.ok(
      samples.every((s) => s.sameState && s.sameAngle),
      "Rendering cannot alter simulation or double-spin gears",
    );
    const driven = samples.filter(
      (s, i) => i && Math.abs(s.angle - samples[i - 1].angle) > 0.001,
    ).length;
    assert.ok(
      driven >= 8,
      `Natural obstacle encounter drives the gear (${driven} frames)`,
    );
    const paused = await page.evaluate(() => {
      const a = window.__chainDrive;
      const g = a.game.state.gears[0];
      a.game.pause();
      const angle = a.renderer.gearMotion.angle(g);
      const time = a.game.state.time;
      for (let n = 0; n < 20; n++) a.stepFrames(1);
      return {
        sameAngle: angle === a.renderer.gearMotion.angle(g),
        sameTime: time === a.game.state.time,
      };
    });
    assert.ok(paused.sameAngle && paused.sameTime);
    await setup(124);
    await page.evaluate(() => {
      const a = window.__chainDrive;
      a.game.debug("hitLink", { index: 3 });
      a.stepFrames(4);
    });
    await page.screenshot({ path: `${output}/${name}-split.png` });
    const promoted = await page.evaluate(() =>
      window.__chainDrive.game.state.sections.map((s) => s.links[0]),
    );
    assert.equal(promoted.length, 2);
    assert.ok(promoted.every((l) => l.leader));
    await page.evaluate(() => {
      const a = window.__chainDrive;
      a.game.debug("scenario", { name: "crowded" });
      a.draw();
    });
    await page.screenshot({ path: `${output}/${name}-crowded.png` });
    await page.evaluate(() => {
      const a = window.__chainDrive;
      a.game.debug("scenario", { name: "poison" });
      for (let n = 0; n < 12; n++) a.stepFrames(1);
    });
    await page.screenshot({ path: `${output}/${name}-poison.png` });
    assert.deepEqual(errors, []);
    reports.push({
      browser: name,
      version: browser.version(),
      drivenFrames: driven,
      errors,
      checks: [
        "normal obstacle gear engagement",
        "render cannot mutate gameplay",
        "redraw does not double-spin",
        "pause freezes gear and game",
        "immediate split promotion",
        "screenshots of straight chain, turns, split, crowded, poison and four gear damage states",
      ],
      samples,
    });
  } finally {
    await browser.close();
  }
}
await writeFile(`${output}/report.json`, JSON.stringify(reports, null, 2));
console.log(reports.map(({ samples, ...report }) => report));
