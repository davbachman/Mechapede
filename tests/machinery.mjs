import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
const url = new URL(process.env.GAME_URL || "http://localhost:5178/");
url.searchParams.set("test", "1"); url.searchParams.set("controls", "window");
const output = process.env.MACHINERY_OUTPUT || "output/machinery";
await mkdir(output, { recursive: true });
const report = [];
for (const [name, type, options] of [["chrome", chromium, { channel: "chrome" }], ["webkit", webkit, {}]]) {
  const browser = await type.launch({ headless: true, ...options });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const checks = [], errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const check = text => { checks.push(text); console.log(`${name}: ${text}`); };
  const frames = n => page.evaluate(n => window.__chainDrive.stepFrames(n), n);
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const shot = suffix => page.screenshot({ path: `${output}/${name}-${suffix}.png` });
  const setup = () => page.evaluate(() => {
    const a = window.__chainDrive; a.setRealtime(false);
    a.game.start(); a.game.debug("clear"); a.input.clear();
    a.game.debug("section", { count: 6, x: 124, y: 36 });
    a.game.state.player = { x: 190, y: 252 };
    a.draw(); a.input.canvas.focus({ preventScroll: true });
  });
  try {
    await page.goto(url.href);
    await page.waitForFunction(() => window.__chainDrive?.renderer.backgroundStatus === "ready");
    await page.keyboard.press("Enter");
    await setup();
    await page.evaluate(() => {
      const a = window.__chainDrive;
      a.game.debug("enemy", { type: "gantry", x: 100, entered: true, phase: "warning", age: 0 });
      a.game.state.player = { x: 100, y: 252 }; a.draw();
    });
    await frames(50);
    assert.equal((await state()).mode, "playing");
    assert.equal((await state()).gantry.phase, "warning");
    await shot("gantry-warning");
    await page.evaluate(() => { window.__chainDrive.game.state.player.x = 190; });
    await frames(13);
    assert.equal((await state()).gantry.extension, 45);
    await shot("gantry-extended");
    check("Gantry marks a harmless fixed column before reaching the bottom of the shooter region");

    await page.evaluate(() => {
      const a = window.__chainDrive; a.draw();
      window.__frozen = { pixels: a.renderer.canvas.toDataURL(), gantry: JSON.stringify(a.game.state.gantry) };
    });
    await page.keyboard.press("KeyP"); await frames(60);
    assert.deepEqual(await page.evaluate(() => ({
      pixels: window.__frozen.pixels === window.__chainDrive.renderer.canvas.toDataURL(),
      gantry: window.__frozen.gantry === JSON.stringify(window.__chainDrive.game.state.gantry),
    })), { pixels: true, gantry: true });
    await shot("paused");
    await page.keyboard.press("Enter");
    check("Pause freezes exact piston pixels and state; Enter resumes without a title screen");

    await page.evaluate(() => {
      const a = window.__chainDrive;
      a.game.state.bullet = { x: 100, y: 254 }; a.stepFrames(1);
    });
    assert.equal((await state()).gantry.hp, 2);
    assert.equal((await state()).gantry.phase, "retract");
    check("A real projectile hits the extended foot and interrupts its strike");

    await setup();
    await page.evaluate(() => {
      const a = window.__chainDrive;
      a.game.debug("gear", { col: 12, row: 12 });
      a.game.debug("enemy", { type: "flywheel", x: 96, y: 88, vx: 30, vy: 85 });
      a.draw();
    });
    await shot("before-bounce");
    await frames(5);
    let s = await state();
    assert.equal(s.gears.length, 0);
    assert.equal(s.fallingGears.length, 1);
    assert.ok(s.flywheel.vy < 0);
    assert.ok(s.flywheel.vx < 0, "oblique impact deflects to the left");
    await shot("after-bounce");
    const upwardY = s.flywheel.y;
    await frames(10);
    assert.ok((await state()).flywheel.y < upwardY);
    await frames(40);
    assert.ok((await state()).flywheel.vy > 0);
    check("An oblique top impact rebounds upward, knocks its gear loose, and returns to a falling arc");

    await setup();
    await page.evaluate(() => {
      const a = window.__chainDrive;
      a.game.debug("enemy", { type: "flywheel", x: 120, y: 110, vx: 60, vy: 30 }); a.draw();
    });
    const bounds = await page.evaluate(() => {
      const a = window.__chainDrive, c = a.renderer.c;
      const wheel = a.game.state.flywheel;
      const read = () => c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
      const before = read(); a.game.state.flywheel = null; a.draw(); const after = read();
      a.game.state.flywheel = wheel; a.draw();
      let minX = 1e9, minY = 1e9, maxX = 0, maxY = 0;
      for (let y = Math.floor(c.canvas.height * 99 / 256); y < c.canvas.height * 121 / 256; y++)
        for (let x = Math.floor(c.canvas.width * 109 / 240); x < c.canvas.width * 131 / 240; x++) {
          const i = (y * c.canvas.width + x) * 4;
          if (Math.max(...[0,1,2].map(k => Math.abs(before[i+k]-after[i+k]))) < 15) continue;
          minX = Math.min(minX,x); maxX = Math.max(maxX,x);
          minY = Math.min(minY,y); maxY = Math.max(maxY,y);
        }
      return { width: maxX-minX+1, height: maxY-minY+1 };
    });
    assert.ok(Math.abs(bounds.width - bounds.height) <= 2, JSON.stringify(bounds));
    assert.ok(bounds.width > 25);
    check("The rendered flywheel is round at the actual board aspect ratio");

    await setup();
    await page.evaluate(() => {
      const a = window.__chainDrive;
      a.game.debug("enemy", { type: "gantry", x: 64, entered: true, phase: "warning" });
      a.game.debug("enemy", { type: "flywheel", x: 126, y: 178, vx: -30, vy: 60 });
      a.game.state.fallingGears = [
        { id: 998, x: 114, y: 225, vx: 15, vy: 90, spin: 6, angle: 0.8 },
        { id: 999, x: 160, y: 210, vx: -8, vy: 80, spin: -5, angle: 1.3 },
      ];
      for (const [col,row] of [[8,8],[14,12],[19,18],[5,23],[24,28]])
        a.game.debug("gear", { col, row });
      a.draw();
    });
    await shot("machinery");
    await page.evaluate(() => {
      const a = window.__chainDrive;
      a.game.state.bullet = { x: 114, y: 230 }; a.stepFrames(1);
    });
    assert.equal((await state()).fallingGears.length, 1);
    assert.equal((await state()).score, 1);
    check("Falling gears are distinct hazards and can be shattered by a single pulse");
    await page.evaluate(() => {
      const a = window.__chainDrive;
      const e = a.game.state.fallingGears[0];
      Object.assign(e, { x: 1, y: 249, vx: 0, vy: 0 });
      a.game.state.player = { x: 239, y: 252 }; a.stepFrames(1);
    });
    assert.equal((await state()).mode, "dying");
    check("A falling gear can hit the shooter across the connected sides");

    await setup();
    await page.evaluate(() => {
      const a = window.__chainDrive;
      a.game.debug("enemy", { type: "flywheel", x: 120, y: 230, vx: 0, vy: 30 });
      a.game.state.bullet = { x: 120, y: 236 }; a.stepFrames(1);
    });
    assert.equal((await state()).flywheel, null);
    assert.equal((await state()).score, 1000);
    check("A real projectile destroys the flywheel for 1,000 points");

    await page.setViewportSize({ width: 514, height: 683 });
    await setup();
    await page.evaluate(() => {
      const a = window.__chainDrive;
      a.game.debug("scenario", { name: "enemies" });
      Object.assign(a.game.state.gantry, { x: 80, phase: "warning", extension: 0 });
      Object.assign(a.game.state.flywheel, { x: 126, y: 166 });
      a.game.state.fallingGears = [{ id: 998, x: 112, y: 235, vx: 12, vy: 90, angle: 0.6, spin: 6 }];
      a.draw();
    });
    await shot("narrow-warning");
    await page.evaluate(() => {
      Object.assign(window.__chainDrive.game.state.gantry, { phase: "hold", extension: 45 });
      window.__chainDrive.draw();
    });
    await shot("narrow-strike");
    const layout = await page.locator("canvas").boundingBox();
    assert.equal(layout.y, 0);
    assert.ok(Math.abs(layout.width / layout.height - 0.75) < 0.002);
    check("Gantry, flywheel and falling debris fit the full-height 514×683 board");
    const voices = await page.evaluate(async () => {
      const audio = window.__chainDrive.audio;
      await audio.unlock();
      const counts = {};
      for (const event of ["gantry-warning", "gantry-strike", "gantry-impact", "gantry-hit", "gantry-destroy", "flywheel-spawn", "gear-knock", "flywheel-destroy"]) {
        audio.stop(true); audio.lastEvents.clear(); audio.play(event);
        counts[event] = audio.voices.size;
      }
      audio.stop(true);
      return counts;
    });
    assert.ok(Object.values(voices).every(count => count > 0), JSON.stringify(voices));
    check("Every new warning, motor, impact and destruction cue produces Web Audio voices");
    assert.deepEqual(errors, []);
    report.push({ browser: name, version: browser.version(), checks, errors, bounds });
  } catch (error) {
    report.push({ browser: name, checks, errors, failure: error.stack }); throw error;
  } finally {
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
    await browser.close();
  }
}
