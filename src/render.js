// Original vector mechanical sprites. Coordinates are arcade pixels; backing store follows DPR.
import { GearMotion } from "./gear-motion.js";
import { TreadMotion } from "./tread-motion.js";
import { chainPoses } from "./chain-pose.js";
const TAU = Math.PI * 2;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}
function line(c, x1, y1, x2, y2, color, width = 1) {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}
function cogPath(c, r, teeth = 10, damage = 0, root = 0.78) {
  c.beginPath();
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * TAU;
    let rr = i % 4 === 0 || i % 4 === 3 ? r * root : r;
    if (damage && Math.floor(i / 4) % 4 < damage && i % 4 !== 0) rr *= 0.68;
    const x = Math.cos(a) * rr,
      y = Math.sin(a) * rr;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.closePath();
}
const TRACK_AXLE = 1.7;
const TRACK_RADIUS = 1.85;
const TRACK_LENGTH = 4 * TRACK_AXLE + TAU * TRACK_RADIUS;
const TRACK_PADS = 10;
const TRACK_PITCH = TRACK_LENGTH / TRACK_PADS;
function trackPath(c, radius = TRACK_RADIUS) {
  roundRect(
    c,
    -TRACK_AXLE - radius,
    -radius,
    2 * (TRACK_AXLE + radius),
    2 * radius,
    radius,
  );
}
// A pad follows both straight runs and both curved ends of a continuous belt.
function trackPoint(distance) {
  let d = ((distance % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
  const run = 2 * TRACK_AXLE;
  if (d < run) return { x: -TRACK_AXLE + d, y: -TRACK_RADIUS, angle: 0 };
  d -= run;
  if (d < Math.PI * TRACK_RADIUS) {
    const a = d / TRACK_RADIUS - Math.PI / 2;
    return {
      x: TRACK_AXLE + Math.cos(a) * TRACK_RADIUS,
      y: Math.sin(a) * TRACK_RADIUS,
      angle: a + Math.PI / 2,
    };
  }
  d -= Math.PI * TRACK_RADIUS;
  if (d < run) return { x: TRACK_AXLE - d, y: TRACK_RADIUS, angle: Math.PI };
  d -= run;
  const a = d / TRACK_RADIUS + Math.PI / 2;
  return {
    x: -TRACK_AXLE + Math.cos(a) * TRACK_RADIUS,
    y: Math.sin(a) * TRACK_RADIUS,
    angle: a + Math.PI / 2,
  };
}
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.c = canvas.getContext("2d", { alpha: false });
    this.particles = [];
    this.labels = [];
    this.hiddenPlayer = false;
    this.lastTime = 0;
    this.gearMotion = new GearMotion({ toothRadius: 4.2 });
    this.treadMotion = new TreadMotion();
    this.backgroundStatus = "loading";
    this.machineImage = new Image();
    this.machineImage.decoding = "async";
    this.machineImage.onload = () => {
      this.backgroundStatus = "ready";
      this.backplate = null;
    };
    this.machineImage.onerror = () => {
      this.backgroundStatus = "fallback";
    };
    this.machineImage.src = new URL(
      "../assets/machine-interior.png",
      import.meta.url,
    ).href;
    this.resize();
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.scale = this.canvas.width / 240;
    // The upright arcade field has non-square logical pixels. Keep circular
    // hardware round on screen while retaining its width and mounting position.
    this.roundScaleY = (rect.width * 256) / (rect.height * 240) || 1;
    this.treadMotion.pixelAspectY = this.roundScaleY;
    this.gearMotion.pixelAspectY = this.roundScaleY;
    this.backplate = null;
  }
  events(events) {
    for (const e of events) {
      const type = e.type || "",
        x = e.x ?? 120,
        y = e.y ?? 128;
      if (type === "player-death" || type === "playerDeath")
        this.hiddenPlayer = true;
      if (type === "start") {
        this.hiddenPlayer = false;
        this.particles = [];
        this.labels = [];
        this.gearMotion.reset();
        this.treadMotion.reset();
      }
      if (type === "life-start") this.hiddenPlayer = false;
      if (/destroy|Break|Death|death/.test(type) || type === "gear-remove") {
        const count = /player/.test(type) ? 28 : type === "gear-remove" ? 5 : 9;
        for (let i = 0; i < count; i++)
          this.particles.push({
            x,
            y,
            vx: Math.cos(i * 2.4) * (0.4 + (i % 4) * 0.3),
            vy: Math.sin(i * 2.4) * (0.3 + (i % 3) * 0.3),
            life: 1,
            max: 0.25 + (i % 5) * 0.06,
            color: /gear/.test(type)
              ? "#d6ad66"
              : /player/.test(type)
                ? "#ffe5ae"
                : "#bdced0",
          });
      }
      if (type === "gear-create")
        this.particles.push({
          x,
          y,
          life: 1,
          max: 0.22,
          mount: true,
          color: "#efd098",
        });
      if (type === "gear-remove")
        this.particles.push({
          x,
          y,
          vx: 1.1,
          vy: -0.75,
          life: 1,
          max: 0.24,
          looseGear: true,
          color: "#b99d66",
        });
      if (type === "head-activate" || type === "headActivate")
        this.particles.push({
          x,
          y,
          life: 1,
          max: 0.2,
          ring: true,
          color: "#ffd08a",
        });
      if (e.points && /crawler|drone|dispenser/.test(type))
        this.labels.push({ x, y, text: String(e.points), life: 1 });
    }
  }
  draw(s, delta = 1 / 60) {
    const c = this.c;
    c.setTransform(
      this.canvas.width / 240,
      0,
      0,
      this.canvas.height / 256,
      0,
      0,
    );
    c.clearRect(0, 0, 240, 256);
    const t = s.time || 0;
    this.background(s.wave || 1, t);
    this.workLight(s);
    this.gearMotion.update(s);
    this.treadMotion.update(s);
    for (const gear of s.gears || []) this.gear(gear, t);
    for (const section of s.sections || []) this.chain(section, t, s.gears);
    if (s.drone) this.drone(s.drone, t);
    if (s.dispenser) this.dispenser(s.dispenser, t);
    if (s.crawler) this.crawler(s.crawler, t);
    const b = s.bullet;
    if (b) {
      c.fillStyle = "#fffbe0";
      roundRect(c, b.x - 0.65, b.y - 3, 1.3, 5, 0.4);
      c.fill();
      c.fillStyle = "#eac17577";
      c.fillRect(b.x - 1.1, b.y + 2, 2.2, 3);
    }
    // Preserve carriage visibility when pausing a death animation, including when
    // the death and pause events arrive before the next rendered frame.
    if (s.mode !== "paused")
      this.hiddenPlayer = s.mode === "dying" || s.mode === "gameover";
    if (s.player && s.mode !== "title" && !this.hiddenPlayer)
      this.player(s.player, t, s.mode);
    const active = !["paused", "title"].includes(s.mode);
    if (active) {
      for (const p of this.particles) {
        p.life -= delta / p.max;
        if (!p.ring && !p.mount) {
          p.x += p.vx * delta * 60;
          p.y += p.vy * delta * 60;
          p.vy += 0.035 * delta * 60;
        }
      }
      for (const p of this.labels) p.life -= delta / 0.9;
    }
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      c.globalAlpha = Math.max(0, p.life);
      c.fillStyle = p.color;
      if (p.mount) {
        const r = 3.8 + p.life * 2.8;
        c.globalAlpha = p.life * 0.8;
        // Four short mounting jaws close around an already-solid gear. Nothing
        // delays the obstacle appearing or changes its collision footprint.
        for (const side of [-1, 1]) {
          line(
            c,
            p.x + side * r,
            p.y - 1.1,
            p.x + side * r,
            p.y + 1.1,
            p.color,
            0.5,
          );
          line(
            c,
            p.x - 1.1,
            p.y + side * r,
            p.x + 1.1,
            p.y + side * r,
            p.color,
            0.5,
          );
        }
      } else if (p.ring) {
        c.strokeStyle = p.color;
        c.lineWidth = 0.5;
        c.beginPath();
        c.arc(p.x, p.y, 3 + (1 - p.life) * 5, 0, TAU);
        c.stroke();
      } else {
        c.save();
        c.translate(p.x, p.y);
        if (p.looseGear) c.scale(1, this.roundScaleY);
        c.rotate(p.life * 4);
        if (p.looseGear) {
          cogPath(c, 1.8, 7);
          c.fill();
          c.fillStyle = "#263439";
          c.beginPath();
          c.arc(0, 0, 0.7, 0, TAU);
          c.fill();
        } else c.fillRect(-0.4, -0.4, 1.2, 0.6);
        c.restore();
      }
    }
    c.globalAlpha = 1;
    for (const p of this.labels) {
      if (p.life <= 0) continue;
      c.globalAlpha = clamp(p.life * 2, 0, 1);
      c.font = "bold 5px monospace";
      c.textAlign = "center";
      c.fillStyle = "#f4d79b";
      c.fillText(p.text, p.x, p.y - (1 - p.life) * 8);
    }
    c.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);
    this.labels = this.labels.filter((p) => p.life > 0);
    if (s.mode === "title") this.attract(t);
  }
  background(wave, t = 0) {
    const c = this.c;
    const hue = [205, 197, 217, 190][(wave - 1) % 4];
    if (this.backgroundStatus === "ready") {
      // Bake the large image and fixed illumination only on load/resize. Keep
      // the native artwork's 3:4 aspect in the final display, independently of
      // the arcade's non-square logical pixels.
      if (!this.backplate) {
        this.backplate = document.createElement("canvas");
        this.backplate.width = this.canvas.width;
        this.backplate.height = this.canvas.height;
        const b = this.backplate.getContext("2d", { alpha: false });
        b.drawImage(
          this.machineImage,
          0,
          0,
          this.backplate.width,
          this.backplate.height,
        );
        b.setTransform(
          this.backplate.width / 240,
          0,
          0,
          this.backplate.height / 256,
          0,
          0,
        );
        b.fillStyle = "#08101924";
        b.fillRect(0, 0, 240, 256);
        // Recess the perimeter machinery behind the actual game objects.
        const edge = b.createLinearGradient(0, 0, 240, 0);
        edge.addColorStop(0, "#04080d45");
        edge.addColorStop(0.21, "#04080d05");
        edge.addColorStop(0.78, "#04080d05");
        edge.addColorStop(1, "#04080d45");
        b.fillStyle = edge;
        b.fillRect(0, 0, 240, 256);
      }
      c.drawImage(this.backplate, 0, 0, 240, 256);
      c.fillStyle = `hsla(${hue} 45% 48% / 0.025)`;
      c.fillRect(0, 0, 240, 256);
      // Small failing work lamps breathe inside existing recesses; nothing
      // flashes across the field or changes the simulation on pause.
      const voltage =
        0.55 + Math.sin(t * 1.7) * 0.18 + Math.sin(t * 6.1) * 0.035;
      for (const [x, y, radius, color] of [
        [27, 75, 16, "213,131,53"],
        [228, 221, 17, "201,76,42"],
      ]) {
        const lamp = c.createRadialGradient(x, y, 0, x, y, radius);
        lamp.addColorStop(0, `rgba(${color},${voltage * 0.105})`);
        lamp.addColorStop(1, `rgba(${color},0)`);
        c.fillStyle = lamp;
        c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      this.playerRegion();
      return;
    }
    c.fillStyle = `hsl(${hue} 22% 10%)`;
    c.fillRect(0, 0, 240, 256);
    for (let y = 0; y < 256; y += 32) {
      for (let x = 0; x < 240; x += 48) {
        c.fillStyle = (x / 48 + y / 32) % 2 ? "#ffffff02" : "#ffffff04";
        c.fillRect(x + 1, y + 1, 46, 30);
        line(c, x + 1, y + 31, x + 47, y + 31, "#050c1266", 0.5);
        for (const dx of [3, 45]) {
          c.fillStyle = "#52646728";
          c.beginPath();
          c.arc(x + dx, y + 3, 0.65, 0, TAU);
          c.fill();
        }
      }
    }
    this.playerRegion();
    const g = c.createLinearGradient(0, 0, 240, 0);
    g.addColorStop(0, "#00000032");
    g.addColorStop(0.08, "#00000000");
    g.addColorStop(0.92, "#00000000");
    g.addColorStop(1, "#00000032");
    c.fillStyle = g;
    c.fillRect(0, 0, 240, 256);
  }
  playerRegion() {
    const c = this.c;
    const shade = c.createLinearGradient(0, 208, 0, 256);
    shade.addColorStop(0, "#04090905");
    shade.addColorStop(1, "#04090936");
    c.fillStyle = shade;
    c.fillRect(0, 208, 240, 48);
    c.setLineDash([1.5, 3]);
    line(c, 3, 207.5, 237, 207.5, "#c4aa7933", 0.4);
    c.setLineDash([]);
    for (let y = 213; y < 256; y += 16) {
      line(c, 1, y, 1, y + 4, "#c1d4c027", 0.6);
      line(c, 239, y, 239, y + 4, "#c1d4c027", 0.6);
    }
  }
  workLight(s) {
    const c = this.c;
    if (
      s.player &&
      !this.hiddenPlayer &&
      !["title", "dying", "gameover"].includes(s.mode)
    ) {
      const { x, y } = s.player;
      const glow = c.createRadialGradient(x, y - 3, 1, x, y - 3, 13);
      glow.addColorStop(0, "#e8c88722");
      glow.addColorStop(0.4, "#bf995010");
      glow.addColorStop(1, "#bf995000");
      c.fillStyle = glow;
      c.fillRect(x - 13, y - 16, 26, 26);
    }
    if (s.bullet) {
      const { x, y } = s.bullet;
      const glow = c.createRadialGradient(x, y, 0, x, y, 5);
      glow.addColorStop(0, "#ffdb8833");
      glow.addColorStop(1, "#ffdb8800");
      c.fillStyle = glow;
      c.fillRect(x - 5, y - 5, 10, 10);
    }
  }
  gear(g, t) {
    const c = this.c,
      hp = g.hp ?? 4,
      e = g.electrified;
    const angle = this.gearMotion.angle(g);
    c.save();
    c.translate(g.x, g.y);
    c.scale(1, this.roundScaleY);
    c.fillStyle = "#05090ccc";
    c.beginPath();
    c.ellipse(0.35, 0.85, 4.5, 4.2, 0, 0, TAU);
    c.fill();
    // Tooth ring and spokes turn around a fixed mounting axle. An asymmetric
    // witness mark makes even a small amount of driven rotation readable.
    const shade = c.createLinearGradient(-2, -4, 2, 4);
    shade.addColorStop(0, e ? "#c3eeea" : "#e1c48b");
    shade.addColorStop(0.35, e ? "#85b7be" : "#b9995a");
    shade.addColorStop(0.62, e ? "#476d7b" : "#7b5e33");
    shade.addColorStop(1, e ? "#77a8ae" : "#b08c4f");
    c.save();
    c.rotate(angle);
    cogPath(c, 4.2, 10, 4 - hp);
    c.fillStyle = shade;
    c.fill();
    c.strokeStyle = e ? "#b1e9e6" : "#e1c48d";
    c.lineWidth = 0.28;
    c.stroke();
    c.beginPath();
    c.arc(0, 0, 2.75, 0, TAU);
    c.fillStyle = e ? "#203b44" : "#302c23";
    c.fill();
    c.strokeStyle = e ? "#527c89" : "#755e3b";
    c.lineWidth = 0.45;
    c.stroke();
    for (let i = 0; i < 3; i++) {
      const a = (i * TAU) / 3;
      line(
        c,
        Math.cos(a) * 0.8,
        Math.sin(a) * 0.8,
        Math.cos(a) * 2.65,
        Math.sin(a) * 2.65,
        e ? "#8dbdc4" : "#c0a16b",
        0.75,
      );
    }
    line(c, 2.95, -0.2, 3.7, -0.2, e ? "#e2fff7" : "#fff0c5", 0.6);
    for (let i = hp; i < 4; i++) {
      const a = i * 1.6 + 0.2;
      line(
        c,
        Math.cos(a) * 1.4,
        Math.sin(a) * 1.4,
        Math.cos(a + 0.25) * 4,
        Math.sin(a + 0.25) * 4,
        "#101b20",
        0.85,
      );
    }
    c.restore();
    c.beginPath();
    c.arc(0, 0, 1.05, 0, TAU);
    c.fillStyle = "#152026";
    c.fill();
    c.strokeStyle = e ? "#82aeb3" : "#ab9570";
    c.lineWidth = 0.4;
    c.stroke();
    line(c, -0.4, -0.4, 0.4, 0.4, "#c1c7b5", 0.4);
    const contact = this.gearMotion.contact(g);
    if (contact) {
      const a = Math.atan2(
        (contact.y - g.y) / this.roundScaleY,
        contact.x - g.x,
      );
      c.beginPath();
      c.arc(0, 0, 4.22, a - 0.12, a + 0.12);
      c.strokeStyle = e ? "#c9ffff" : "#eee1bb";
      c.lineWidth = 0.55;
      c.stroke();
    }
    if (e) {
      const k = Math.floor(t * 12 + g.x) % 4;
      c.strokeStyle = "#a0eff6";
      c.lineWidth = 0.45;
      c.beginPath();
      c.moveTo(-4, -2);
      c.lineTo(-3 - k * 0.2, -3.8);
      c.lineTo(-1.7, -3.4);
      c.lineTo(-0.5, -5);
      c.stroke();
      c.beginPath();
      c.moveTo(2, 3);
      c.lineTo(3.7, 2);
      c.lineTo(3.1, 4);
      c.lineTo(4.4, 3.3);
      c.stroke();
    }
    c.restore();
  }
  chain(section, t, gears = []) {
    const c = this.c;
    const poses = chainPoses(section, gears);
    // Short articulated drawbars keep the convoy connected. Each belt is a
    // complete machine, including followers and newly promoted leaders.
    for (let i = 1; i < poses.length; i++) {
      const a = poses[i - 1],
        b = poses[i];
      if (Math.hypot(a.x - b.x, a.y - b.y) > 13) continue;
      line(c, a.x, a.y + 0.35, b.x, b.y + 0.35, "#03080a", 1.25);
      line(c, a.x, a.y, b.x, b.y, "#435b66", 0.65);
      line(c, a.x, a.y - 0.12, b.x, b.y - 0.12, "#82999f", 0.2);
    }
    for (let i = poses.length - 1; i >= 0; i--)
      this.trackedUnit(poses[i], poses[i].head, section.poisoned, t);
  }
  trackedUnit(l, head, poisoned, t) {
    const c = this.c;
    const travel = this.treadMotion.travel(l);
    // Convert the heading as well as the pixel aspect: circular drive gears
    // remain round when the complete belt assembly turns around an obstacle.
    const angle = Math.atan2(
      Math.sin(l.angle || 0) / this.roundScaleY,
      Math.cos(l.angle || 0),
    );
    c.save();
    c.translate(l.x, l.y);
    c.scale(1, this.roundScaleY);
    c.rotate(angle);
    c.lineJoin = "round";
    c.lineCap = "round";

    c.save();
    c.translate(0, 0.45);
    trackPath(c, TRACK_RADIUS + 0.24);
    c.fillStyle = "#020609bf";
    c.fill();
    c.restore();
    trackPath(c);
    c.fillStyle = "#0c171c";
    c.fill();
    c.strokeStyle = head ? "#c79b56" : "#93aeb7";
    c.lineWidth = 0.76;
    c.stroke();

    // Inner guide rail meets the gear teeth; separate metal shoes circulate
    // along the outside. The active unit uses the same existing rail and lamp.
    trackPath(c, TRACK_RADIUS - 0.21);
    c.strokeStyle = head ? "#f5bc65" : "#233a43";
    c.lineWidth = head ? 0.3 : 0.22;
    c.stroke();
    line(c, -TRACK_AXLE, 0, TRACK_AXLE, 0, "#526771", 0.6);
    for (const x of [-TRACK_AXLE, TRACK_AXLE]) {
      c.save();
      c.translate(x, 0);
      // Broad teeth and a single dark sector remain readable at arcade scale.
      // Six teeth pass at the same cadence as the ten circulating belt shoes.
      c.rotate((travel / TRACK_PITCH) * (TAU / 6));
      cogPath(c, 1.6, 6, 0, 0.9);
      const metal = c.createLinearGradient(-1, -1.55, 1, 1.55);
      metal.addColorStop(0, head ? "#f4d198" : "#e4ece8");
      metal.addColorStop(0.45, head ? "#d3a866" : "#b4c7cc");
      metal.addColorStop(1, head ? "#97703a" : "#738d98");
      c.fillStyle = metal;
      c.fill();
      c.strokeStyle = "#263e48";
      c.lineWidth = 0.13;
      c.stroke();
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, 1.18, -0.65, 1.05);
      c.closePath();
      c.fillStyle = "#233942";
      c.fill();
      c.restore();
      c.beginPath();
      c.arc(x, 0, 0.35, 0, TAU);
      c.fillStyle = "#101d23";
      c.fill();
      c.strokeStyle = "#c5d2cc";
      c.lineWidth = 0.18;
      c.stroke();
    }

    for (let i = 0; i < TRACK_PADS; i++) {
      const pad = trackPoint(i * TRACK_PITCH + travel);
      c.save();
      c.translate(pad.x, pad.y);
      c.rotate(pad.angle);
      roundRect(c, -0.64, -0.34, 1.28, 0.68, 0.12);
      c.fillStyle = head ? "#cfab70" : "#b0c2c6";
      c.fill();
      c.restore();
    }
    roundRect(c, -0.72, -1.58, 1.44, 0.87, 0.23);
    c.fillStyle = "#0b171c";
    c.fill();
    roundRect(c, -0.51, -1.38, 1.02, 0.46, 0.15);
    c.fillStyle = head ? "#ffe1a1" : "#526872";
    c.fill();
    if (head && poisoned) {
      const arc = Math.floor(t * 14) % 3;
      line(c, -3, -2.7, -1.5, -3.2 - arc * 0.2, "#9cecf5", 0.36);
      line(c, -1.5, -3.2 - arc * 0.2, -0.5, -2.5, "#9cecf5", 0.36);
      line(c, -0.5, -2.5, 1, -3, "#9cecf5", 0.36);
    }
    c.restore();
  }
  player(p, t, mode) {
    const c = this.c;
    c.save();
    c.translate(p.x, p.y);
    c.fillStyle = "#05090bcc";
    roundRect(c, -3.95, -0.7, 7.9, 3.25, 0.8);
    c.fill();
    c.fillStyle = "#45545c";
    roundRect(c, -3.9, -0.85, 1.7, 3.2, 0.5);
    c.fill();
    roundRect(c, 2.2, -0.85, 1.7, 3.2, 0.5);
    c.fill();
    for (const x of [-3.05, 3.05])
      for (let y = -0.3; y < 2; y += 0.85)
        line(c, x - 0.5, y, x + 0.5, y, "#a0acaf", 0.35);
    const gr = c.createLinearGradient(0, -1.6, 0, 2.2);
    gr.addColorStop(0, "#d7e2dc");
    gr.addColorStop(0.4, "#829fa7");
    gr.addColorStop(1, "#415c68");
    c.fillStyle = gr;
    c.beginPath();
    c.moveTo(-2.85, 2.05);
    c.lineTo(-3.05, -0.65);
    c.lineTo(-2.2, -1.55);
    c.lineTo(2.2, -1.55);
    c.lineTo(3.05, -0.65);
    c.lineTo(2.85, 2.05);
    c.closePath();
    c.fill();
    c.strokeStyle = "#d4ded4";
    c.lineWidth = 0.4;
    c.stroke();
    c.fillStyle = "#172e35";
    roundRect(c, -1.8, -0.8, 3.6, 1.7, 0.45);
    c.fill();
    c.fillStyle = "#ceeae5";
    c.fillRect(-1.2, -0.3, 2.4, 0.55);
    c.fillStyle = "#c8b083";
    c.fillRect(-0.9, -3.25, 1.8, 2);
    c.fillStyle = "#fff2bc";
    c.fillRect(-0.6, -3.5, 1.2, 0.7);
    line(c, -1.8, 1.55, 1.8, 1.55, "#f0bb6d", 0.6);
    c.restore();
  }
  crawler(e, t) {
    const c = this.c;
    c.save();
    c.translate(e.x, e.y);
    const phase = t * 18;
    for (const side of [-1, 1])
      for (let i = 0; i < 3; i++) {
        const y = (i - 1) * 2.5,
          k = Math.sin(phase + i * 2 + side) * 1.2;
        line(c, side * 3, y, side * 6, y - 1 + k, "#91a1a4", 1);
        line(c, side * 6, y - 1 + k, side * 8, y + 2 - k, "#566f78", 0.9);
        c.fillStyle = "#c1c8b9";
        c.fillRect(side * 6 - 0.45, y - 1 + k - 0.45, 0.9, 0.9);
      }
    c.fillStyle = "#53616a";
    roundRect(c, -5, -3.4, 10, 7, 2.5);
    c.fill();
    c.strokeStyle = "#a9b4b4";
    c.lineWidth = 0.55;
    c.stroke();
    c.fillStyle = "#263840";
    roundRect(c, -3.8, -2.4, 7.6, 4.8, 1.6);
    c.fill();
    line(c, -3.2, 1.5, 3.2, 1.5, "#71818b", 0.5);
    c.fillStyle = "#ff675b";
    c.beginPath();
    c.ellipse(0, -0.8, 1.9, 1.1, 0, 0, TAU);
    c.fill();
    c.fillStyle = "#ffd4a5";
    c.fillRect(-0.9, -1.25, 1.8, 0.5);
    const wrench =
      e.tool > 0 ? Math.sin(clamp(e.tool / 0.25, 0, 1) * Math.PI) : 0;
    const swing = Math.sin(t * 8) * 2 + wrench * 3.2,
      toolY = 6.4 - wrench * 3.8,
      elbowX = 5 + wrench * 1.6,
      elbowY = 5 - wrench * 1.6;
    line(c, 3, 2, elbowX, elbowY, "#c1a06a", 0.9);
    line(c, elbowX, elbowY, 2 + swing, toolY, "#c1a06a", 0.9);
    line(c, 2 + swing, toolY, 1 + swing, toolY - 0.7, "#cdd2c4", 0.8);
    line(c, 2 + swing, toolY, 2.4 + swing, toolY + 1, "#cdd2c4", 0.8);
    if (wrench > 0.65) {
      line(c, 3 + swing, toolY - 1.5, 4 + swing, toolY - 2.4, "#efc888", 0.4);
      line(
        c,
        3.5 + swing,
        toolY + 0.5,
        4.5 + swing,
        toolY + 0.7,
        "#efc888",
        0.4,
      );
    }
    c.restore();
  }
  dispenser(e, t) {
    const c = this.c;
    c.save();
    c.translate(e.x, e.y);
    c.fillStyle = "#8f9b95";
    roundRect(c, -2.8, -5, 5.6, 9, 1);
    c.fill();
    c.strokeStyle = "#ced8c9";
    c.lineWidth = 0.5;
    c.stroke();
    c.fillStyle = "#b5a774";
    c.beginPath();
    c.moveTo(-3.5, -5);
    c.lineTo(3.5, -5);
    c.lineTo(1.8, -1.7);
    c.lineTo(-1.8, -1.7);
    c.closePath();
    c.fill();
    c.fillStyle = "#27353a";
    c.fillRect(-1.8, -3.6, 3.6, 1);
    c.fillRect(-1.3, 0.2, 2.6, 2.5);
    c.fillStyle = e.hp === 1 ? "#fff2ab" : "#e3b85e";
    c.fillRect(-0.7, 0.4, 1.4, 1.5);
    for (const side of [-1, 1]) {
      c.fillStyle = "#516873";
      c.fillRect(side * 3.2 - 0.4, -1, 0.8, 4);
      line(c, side * 1.5, 4, side * 1.9, 5.7, "#c9b377", 0.8);
    }
    c.restore();
  }
  drone(e, t) {
    const c = this.c;
    c.save();
    c.translate(e.x, e.y);
    const dir = e.dir || 1;
    c.scale(dir, 1);
    c.strokeStyle = "#718a90";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(-4, 0);
    c.bezierCurveTo(-8, -4, -10, 5, -12, 2);
    c.stroke();
    c.fillStyle = "#9fb5b8";
    roundRect(c, -5, -2.5, 10, 5, 1.7);
    c.fill();
    c.fillStyle = "#33484e";
    roundRect(c, -4, -1.8, 7, 3.5, 1);
    c.fill();
    c.fillStyle = "#cfac6e";
    c.fillRect(1, -1.3, 2, 2.6);
    for (const x of [-3, 3]) {
      c.fillStyle = "#53676f";
      c.beginPath();
      c.arc(x, 2.5, 1.4, 0, TAU);
      c.fill();
    }
    line(c, -11.5, 2, -13, 2, "#e0f5e8", 0.8);
    line(c, -13, 2, -15 + (Math.floor(t * 17) % 2), 0, "#84e9ef", 0.5);
    line(c, -13, 2, -14, 4, "#ccfeee", 0.5);
    c.restore();
  }
  attract(t) {
    const c = this.c;
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < 7; col++) {
        const x = 14 + col * 34 + (row % 2) * 7,
          y = 13 + row * 35;
        if (x < 236)
          this.gear({ x, y, hp: 4, electrified: row === 5 && col === 6 }, t);
      }
    const links = Array.from({ length: 12 }, (_, i) => ({
      x: 215 - i * 8,
      y: 37 + Math.sin(i * 0.5) * 3,
      angle: Math.cos(i * 0.5) * 0.16,
    }));
    this.chain({ links, poisoned: false }, t);
    this.player({ x: 120, y: 238 }, t);
  }
}
