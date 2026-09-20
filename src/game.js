import { C, clamp } from "./constants.js";

/** Seeded, rendering-independent arcade simulation. All authoritative movement runs
 * at 60 Hz. dx/dy are relative logical-pixel displacements, not velocities.
 * Public state is intentionally inspectable. debug() builds deterministic scenarios. */
export class Game {
  constructor({ seed = 0xc4a1d, highScore = 0 } = {}) {
    this.seed = seed >>> 0;
    this.rng = this.seed;
    this.nextId = 1;
    this.events = [];
    this.accumulator = 0;
    this.pendingInput = { dx: 0, dy: 0, fire: false };
    this.state = this._empty(Math.max(0, Number(highScore) || 0));
  }

  _empty(highScore) {
    return {
      mode: "title",
      score: 0,
      highScore,
      lives: C.START_LIVES,
      wave: 1,
      time: 0,
      frame: 0,
      player: { x: 120, y: C.PLAYER_MAX_Y },
      gears: [],
      sections: [],
      bullet: null,
      crawler: null,
      dispenser: null,
      drone: null,
      effects: [],
      timer: 0,
      timers: {
        crawler: C.CRAWLER_SPAWN,
        dispenser: C.DISPENSER_DELAY,
        drone: C.DRONE_SPAWN,
        extraHead: C.EXTRA_HEAD_DELAY,
      },
      nextLife: C.EXTRA_LIFE_SCORE,
      lowerReached: false,
      headsAdded: 0,
      waveTime: 0,
      fireCooldown: 0,
      mainLength: C.CHAIN_LENGTH,
      chainSpeed: C.FAST_CHAIN_SPEED,
    };
  }

  random() {
    // Mulberry32: integer seed and fully deterministic across supported browsers.
    this.rng = (this.rng + 0x6d2b79f5) >>> 0;
    let t = this.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  _id() {
    return this.nextId++;
  }
  _event(type, detail = {}) {
    this.events.push({ type, time: this.state.time, ...detail });
  }
  _effect(type, x, y, detail = {}) {
    this.state.effects.push({
      id: this._id(),
      type,
      x,
      y,
      age: 0,
      duration: type === "score" ? 0.8 : 0.4,
      ...detail,
    });
  }
  drainEvents() {
    return this.events.splice(0);
  }
  inspect() {
    return JSON.parse(JSON.stringify(this.state));
  }
  start() {
    const highScore = this.state.highScore;
    this.rng = this.seed;
    this.nextId = 1;
    this.events = [];
    this.accumulator = 0;
    this.pendingInput = { dx: 0, dy: 0, fire: false };
    this.state = this._empty(highScore);
    this._generateGears();
    this._spawnWave();
    this.state.mode = "playing";
    this._event("start");
    return this.state;
  }
  pause() {
    if (!["playing", "dying", "wave"].includes(this.state.mode)) return;
    this.beforePause = this.state.mode;
    this.state.beforePause = this.state.mode;
    this.state.mode = "paused";
    this.accumulator = 0;
    this.pendingInput = { dx: 0, dy: 0, fire: false };
    this._event("pause");
  }
  resume() {
    if (this.state.mode !== "paused") return;
    this.state.mode = this.beforePause || "playing";
    this.accumulator = 0;
    this.pendingInput = { dx: 0, dy: 0, fire: false };
    this._event("resume");
  }

  step(input = {}, dt = C.STEP) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (
      this.state.mode === "title" ||
      this.state.mode === "paused" ||
      this.state.mode === "gameover"
    )
      return;
    this.pendingInput.dx += Number.isFinite(input.dx) ? input.dx : 0;
    this.pendingInput.dy += Number.isFinite(input.dy) ? input.dy : 0;
    this.pendingInput.fire = !!input.fire;
    this.accumulator += dt;
    const steps = Math.floor((this.accumulator + 1e-9) / C.STEP);
    if (steps === 0) return;
    const control = {
      dx: this.pendingInput.dx / steps,
      dy: this.pendingInput.dy / steps,
      fire: this.pendingInput.fire,
    };
    this.pendingInput.dx = this.pendingInput.dy = 0;
    for (let i = 0; i < steps; i++) {
      this.accumulator -= C.STEP;
      this._tick(control);
    }
  }

  _tick(input) {
    const s = this.state;
    if (s.mode === "gameover" || s.mode === "paused") return;
    s.time += C.STEP;
    s.frame++;
    for (const e of s.effects) e.age += C.STEP;
    s.effects = s.effects.filter((e) => e.age < e.duration);
    for (const g of s.gears) g.contact = Math.max(0, (g.contact || 0) - C.STEP);
    if (s.mode === "dying") {
      s.deathAge += C.STEP;
      if (s.deathAge + 1e-9 >= C.DEATH_EXPLOSION && !s.repairDone) {
        if (!s.repairQueue)
          s.repairQueue = s.gears
            .filter((g) => g.hp < C.GEAR_HP || g.electrified)
            .map((g) => g.id);
        if (s.repairQueue.length && s.frame % C.REPAIR_FRAMES === 0) {
          const id = s.repairQueue.shift();
          const gear = s.gears.find((g) => g.id === id);
          if (gear) {
            gear.hp = C.GEAR_HP;
            gear.electrified = false;
            this._score(C.REPAIR_SCORE);
            this._effect("repair", gear.x, gear.y);
            this._event("gear-repair", { x: gear.x, y: gear.y });
          }
        }
        if (!s.repairQueue.length) s.repairDone = true;
      }
      if (s.deathAge < C.DEATH_EXPLOSION || s.repairDone) s.timer -= C.STEP;
      if (s.timer <= 0 && s.repairDone) this._resetLife();
      return;
    }
    if (s.mode === "wave") {
      s.timer -= C.STEP;
      if (s.timer <= 1e-9) {
        this._advanceWave();
        this._spawnWave(false);
        s.mode = "playing";
      }
    }
    s.waveTime += C.STEP;
    this._movePlayer(input.dx, input.dy);
    s.fireCooldown = Math.max(0, s.fireCooldown - C.STEP);
    if (input.fire && !s.bullet && s.fireCooldown <= 0) {
      s.bullet = {
        id: this._id(),
        x: s.player.x,
        y: s.player.y - C.SHOT_NOZZLE_OFFSET,
      };
      s.fireCooldown = C.SHOT_COOLDOWN;
      this._event("fire", s.bullet);
    }
    this._moveChains();
    this._moveEnemies();
    this._checkPlayerCollision();
    if (s.mode === "playing" || s.mode === "wave") this._moveBullet();
    if (s.mode === "playing" && s.sections.length === 0) {
      s.mode = "wave";
      s.timer = C.WAVE_DURATION;
      s.pendingWave = true;
      this._event("wave-complete", { wave: s.wave });
    }
  }

  _generateGears() {
    // The arcade makes 46 placement attempts. Repeated cells deliberately collapse.
    for (let n = 0; n < C.INITIAL_GEARS; n++) {
      const col = Math.floor(this.random() * C.COLS);
      const row = C.INITIAL_GEAR_FIRST_ROW + (n % C.INITIAL_GEAR_ROWS);
      this._addGear(col, row, false);
    }
  }
  _addGear(col, row, effect = true) {
    col = clamp(Math.floor(col), 0, C.COLS - 1);
    row = clamp(Math.floor(row), 0, C.ROWS - 1);
    if (row === 0 || row >= C.ROWS - 2) return null;
    let gear = this.state.gears.find((g) => g.col === col && g.row === row);
    if (gear) return gear;
    gear = {
      id: this._id(),
      col,
      row,
      x: col * C.CELL + 4,
      y: row * C.CELL + 4,
      hp: C.GEAR_HP,
      electrified: false,
      contact: 0,
    };
    this.state.gears.push(gear);
    if (effect) {
      this._effect("gear-create", gear.x, gear.y);
      this._event("gear-create", { x: gear.x, y: gear.y, id: gear.id });
    }
    return gear;
  }
  _gearAt(x, y) {
    const col = Math.floor(x / C.CELL),
      row = Math.floor(y / C.CELL);
    return this.state.gears.find((g) => g.col === col && g.row === row);
  }
  _makeSection(count, x, y, dir = 1, options = {}) {
    const links = [];
    const path = [];
    for (let n = 0; n <= (count + 1) * C.LINK_SPACING; n++)
      path.push({ x: x - dir * n, y, dir, vertical: 1, turning: null });
    const occupied = new Set(
      this.state.sections.flatMap((part) =>
        part.links.map((link) => link.slot),
      ),
    );
    for (let n = 0; n < count; n++) {
      const free = Array.from(
        { length: C.CHAIN_LENGTH },
        (_, slot) => slot,
      ).filter((slot) => !occupied.has(slot));
      const slot =
        (options.added ? free.at(-1) : free[0]) ?? C.CHAIN_LENGTH + n;
      occupied.add(slot);
      links.push({
        slot,
        id: this._id(),
        x: x - dir * n * C.LINK_SPACING,
        y,
        angle: dir > 0 ? 0 : Math.PI,
        leader: n === 0,
        isHead: n === 0,
        activation: 0,
        dir,
        vertical: 1,
        turning: null,
      });
    }
    return {
      id: this._id(),
      links,
      dir,
      vertical: 1,
      path,
      target: null,
      turning: null,
      poisoned: false,
      inPlayer: false,
      tailReleased: false,
      added: false,
      ...options,
    };
  }
  _advanceWave() {
    const s = this.state;
    s.wave++;
    if (s.chainSpeed === C.FAST_CHAIN_SPEED) {
      s.mainLength = s.mainLength === 1 ? C.CHAIN_LENGTH : s.mainLength - 1;
      s.chainSpeed =
        s.score >= C.CHAIN_FAST_SCORE ? C.FAST_CHAIN_SPEED : C.CHAIN_SPEED;
    } else s.chainSpeed = C.FAST_CHAIN_SPEED;
  }
  _spawnWave(resetEnemies = true) {
    const s = this.state;
    const detached = C.CHAIN_LENGTH - s.mainLength;
    s.sections = [];
    s.sections.push(this._makeSection(C.CHAIN_LENGTH - detached, 124, 4, 1));
    for (let i = 0; i < detached; i++) {
      const dir = this.random() < 0.5 ? -1 : 1;
      s.sections.push(
        this._makeSection(1, 4 + Math.floor(this.random() * 30) * 8, 4, dir, {
          fast: true,
        }),
      );
    }
    if (resetEnemies) {
      s.bullet = null;
      s.crawler = s.dispenser = s.drone = null;
      s.timers = {
        crawler: C.CRAWLER_SPAWN,
        dispenser: C.DISPENSER_DELAY,
        drone: C.DRONE_SPAWN,
        extraHead: s.timers.extraHead,
      };
    }
    s.lowerReached = false;
    s.waveTime = 0;
    s.pendingWave = false;
    this._event("wave", { wave: s.wave, links: C.CHAIN_LENGTH });
  }
  _speed(section) {
    const last =
      this.state.sections.reduce((n, p) => n + p.links.length, 0) === 1;
    return section.fast || last ? C.FAST_CHAIN_SPEED : this.state.chainSpeed;
  }
  _chainTarget(section) {
    const head = section.links[0];
    if (head.y >= 252 && !section.poisoned) this.state.lowerReached = true;
    const gear = this._gearAt(head.x + section.dir * C.CELL, head.y);
    const boundary =
      (head.x <= 4 && section.dir < 0) || (head.x >= 236 && section.dir > 0);
    const overlap = this.state.sections.some((other) =>
      other.links.some(
        (link) =>
          link.id !== head.id &&
          Math.abs(link.y - head.y) < 0.01 &&
          (link.x - head.x) * section.dir > 0 &&
          (link.x - head.x) * section.dir < C.CHAIN_OVERLAP_DISTANCE,
      ),
    );
    if (gear) {
      gear.contact = 0.2;
      this._event("gear-contact", {
        x: gear.x,
        y: gear.y,
        electrified: gear.electrified,
      });
      if (gear.electrified) {
        if (!section.poisoned)
          this._event("poison", { x: head.x, y: head.y, id: head.id });
        section.poisoned = true;
      }
    }
    if (!section.poisoned && !boundary && !gear && !overlap) return;
    if (head.y >= 252) {
      section.vertical = -1;
      section.poisoned = false;
      section.inPlayer = true;
      this.state.lowerReached = true;
      if (section.links.length > 1 && section.links.at(-1).y >= 252)
        this._releaseTail(section);
    } else if (section.inPlayer && head.y <= C.PLAYER_MIN_Y)
      section.vertical = 1;
    if (section.poisoned) section.vertical = 1;
    section.turning = { progress: 0 };
  }
  _releaseTail(section) {
    const oldCount = section.links.length;
    const tail = section.links.pop();
    if (!tail) return;
    const solo = this._makeSection(
      0,
      tail.x,
      tail.y,
      -(tail.dir || section.dir),
      {
        inPlayer: true,
        vertical: -1,
        fast: section.fast,
        path: section.path.slice((oldCount - 1) * C.LINK_SPACING),
        links: [tail],
        holdRow: true,
      },
    );
    this._activate(tail);
    this.state.sections.push(solo);
  }
  _moveChains() {
    for (const section of [...this.state.sections]) {
      if (!section.links.length) continue;
      const distance = this._speed(section) * C.STEP;
      for (let n = 0; n < distance; n++) {
        const head = section.links[0];
        if (!section.turning) this._chainTarget(section);
        const oldX = head.x,
          oldY = head.y;
        head.x += section.dir;
        if (section.turning) {
          if (!section.holdRow) head.y += section.vertical;
          section.turning.progress++;
          if (section.turning.progress === 4) section.dir *= -1;
          if (section.turning.progress === 8) {
            section.turning = null;
            section.holdRow = false;
          }
        }
        head.angle = Math.atan2(head.y - oldY, head.x - oldX);
        head.dir = section.dir;
        head.vertical = section.vertical;
        head.turning = section.turning ? { ...section.turning } : null;
        section.path.unshift({
          x: head.x,
          y: head.y,
          dir: section.dir,
          vertical: section.vertical,
          turning: head.turning,
          angle: head.angle,
        });
        for (let i = 1; i < section.links.length; i++) {
          const point = section.path[i * C.LINK_SPACING];
          if (!point) continue;
          const link = section.links[i];
          const vx = point.x - link.x,
            vy = point.y - link.y;
          if (Math.abs(vx) + Math.abs(vy) > 0.001)
            link.angle = Math.atan2(vy, vx);
          link.x = point.x;
          link.y = point.y;
          link.dir = point.dir ?? section.dir;
          link.vertical = point.vertical ?? section.vertical;
          link.turning = point.turning ? { ...point.turning } : null;
        }
        section.path.length = Math.min(
          section.path.length,
          (section.links.length + 1) * C.LINK_SPACING + 1,
        );
      }
      for (const link of section.links)
        link.activation = Math.max(0, link.activation - C.STEP);
    }
  }

  _movePlayer(dx, dy) {
    const p = this.state.player;
    dx = clamp(dx, -C.PLAYER_MAX_STEP, C.PLAYER_MAX_STEP);
    dy = clamp(dy, -C.PLAYER_MAX_STEP, C.PLAYER_MAX_STEP);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    const blocked = (x, y) => !!this._gearAt(x, y);
    for (let i = 0; i < steps; i++) {
      const x = clamp(p.x + dx / steps, C.PLAYER_MIN_X, C.PLAYER_MAX_X);
      if (!blocked(x, p.y)) p.x = x;
      const y = clamp(p.y + dy / steps, C.PLAYER_MIN_Y, C.PLAYER_MAX_Y);
      if (!blocked(p.x, y)) p.y = y;
    }
  }

  _moveBullet() {
    const s = this.state,
      bullet = s.bullet;
    if (!bullet) return;
    if (bullet.y <= C.SHOT_TOP) {
      s.bullet = null;
      return;
    }
    const previousY = bullet.y;
    bullet.y -= C.SHOT_SPEED * C.STEP;

    // SHOOT probes the previous hardware V position + 1, rounded by OBSTAC.
    // Convert that bottom-up row address into this top-down logical field.
    const col = Math.floor(bullet.x / C.CELL);
    const row =
      C.ROWS -
      1 -
      Math.floor(
        (C.HEIGHT - previousY + C.SHOT_GEAR_PROBE_OFFSET + C.CELL / 2) / C.CELL,
      );
    const gear = s.gears.find((g) => g.col === col && g.row === row);
    if (gear) {
      s.bullet = null;
      this._hitGear(gear);
      return;
    }

    const touches = (object, width = C.SHOT_HIT_X, height = C.SHOT_HIT_Y) =>
      Math.abs(object.x - bullet.x) < width &&
      Math.abs(object.y - bullet.y) < height;
    // The ROM scans fixed moving-object slots 13, 12, then 11 through 0.
    // Sprite art, pulse length, distance and section order do not change priority.
    if (s.crawler && touches(s.crawler, C.SHOT_WIDE_HIT_X)) {
      s.bullet = null;
      this._hitEnemy("crawler");
      return;
    }
    if (
      s.dispenser &&
      touches(
        s.dispenser,
        C.SHOT_HIT_X,
        s.dispenser.speed >= C.DISPENSER_HIT_SPEED
          ? C.SHOT_FAST_DISPENSER_HIT_Y
          : C.SHOT_HIT_Y,
      )
    ) {
      s.bullet = null;
      this._hitEnemy("dispenser");
      return;
    }
    if (s.drone && touches(s.drone, C.SHOT_WIDE_HIT_X)) {
      s.bullet = null;
      this._hitEnemy("drone");
      return;
    }
    const slots = s.sections
      .flatMap((section) => section.links.map((link) => ({ section, link })))
      .sort((a, b) => b.link.slot - a.link.slot);
    for (const { section, link } of slots)
      if (touches(link)) {
        s.bullet = null;
        this._hitLink(section, link);
        return;
      }
  }

  _hitGear(gear) {
    gear.hp--;
    this._event("gear-hit", { x: gear.x, y: gear.y, hp: gear.hp });
    this._effect("spark", gear.x, gear.y);
    if (gear.hp <= 0) {
      this.state.gears = this.state.gears.filter((g) => g !== gear);
      this._score(C.GEAR_SCORE);
      this._effect("gear-destroy", gear.x, gear.y);
      this._event("gear-destroy", { x: gear.x, y: gear.y });
    }
  }
  _activate(link) {
    link.leader = link.isHead = true;
    link.activation = 0.3;
    this._event("head-activate", { x: link.x, y: link.y, id: link.id });
    this._effect("head-activate", link.x, link.y);
  }
  _hitLink(section, link) {
    const index = section.links.indexOf(link);
    if (index < 0) return;
    const wasHead = index === 0;
    this._score(wasHead ? C.HEAD_SCORE : C.BODY_SCORE);
    this._event("link-destroy", {
      x: link.x,
      y: link.y,
      id: link.id,
      head: wasHead,
    });
    this._effect("link-destroy", link.x, link.y, { angle: link.angle });
    // The ROM's CALLS/OBSTAC address is one tile in the struck link's direction.
    this._addGear(
      Math.floor((link.x + (link.dir ?? section.dir) * C.CELL) / C.CELL),
      Math.floor(link.y / C.CELL),
    );
    const rear = section.links.slice(index + 1);
    section.links = section.links.slice(0, index);
    if (rear.length) {
      const h = rear[0];
      const child = this._makeSection(0, h.x, h.y, h.dir ?? section.dir, {
        links: rear,
        path: section.path.slice((index + 1) * C.LINK_SPACING),
        vertical: h.vertical ?? section.vertical,
        inPlayer: section.inPlayer,
        poisoned: false,
        fast: section.fast,
        turning: h.turning ? { ...h.turning } : null,
        tailReleased: true,
        added: section.added,
      });
      this._activate(h);
      this.state.sections.push(child);
    }
    this.state.sections = this.state.sections.filter(
      (part) => part.links.length,
    );
  }
  _score(points, x, y) {
    const s = this.state;
    s.score += points;
    if (s.score > s.highScore) {
      s.highScore = s.score;
      this._event("high-score", { score: s.highScore });
    }
    if (x !== undefined)
      this._effect("score", x, y, { text: String(points), points });
    this._event("score", { points, score: s.score, x, y });
    while (s.score >= s.nextLife) {
      s.nextLife += C.EXTRA_LIFE_SCORE;
      const cap = s.mode === "dying" ? C.MAX_RESERVE_LIVES : C.MAX_LIVES;
      if (s.lives < cap) {
        s.lives++;
        this._event("extra-life", { lives: s.lives });
      }
    }
  }

  _crawlerMinY() {
    return (
      C.CRAWLER_MIN_Y +
      Math.min(
        C.CRAWLER_MAX_RESTRICTION_ROWS,
        Math.max(
          0,
          Math.floor(
            (this.state.score - C.ENEMY_FAST_SCORE) / C.DIFFICULTY_SCORE_STEP,
          ),
        ),
      ) *
        C.CELL
    );
  }
  _spawnCrawler() {
    const dir = this.random() < 0.5 ? 1 : -1;
    const minY = this._crawlerMinY();
    this.state.crawler = {
      id: this._id(),
      x: dir > 0 ? -8 : C.WIDTH + 8,
      y: minY,
      dir,
      vx: dir,
      vy: this.random() < 0.5 ? -1 : 1,
      speed:
        this.state.score >= C.CRAWLER_FAST_SCORE
          ? C.CRAWLER_FAST_SPEED
          : C.CRAWLER_SLOW_SPEED,
      phase:
        this.random() < 0.5
          ? C.CRAWLER_FIRST_PHASE_SHORT
          : C.CRAWLER_FIRST_PHASE_LONG,
      life: 0,
      tool: 0,
    };
    this._event("crawler-spawn", this.state.crawler);
  }
  _spawnDispenser() {
    const col = 1 + Math.floor(this.random() * (C.COLS - 2));
    this.state.dispenser = {
      id: this._id(),
      x: col * C.CELL + 4,
      y: -8,
      hp: 2,
      lastRow: -1,
      speed:
        this.state.score >= C.ENEMY_FAST_SCORE
          ? C.DISPENSER_FAST_SPEED
          : C.DISPENSER_SPEED,
    };
    this._event("dispenser-spawn", this.state.dispenser);
  }
  _spawnDrone() {
    const dir = this.random() < 0.5 ? 1 : -1;
    const row =
      C.DRONE_MIN_ROW +
      Math.floor(this.random() * (C.DRONE_MAX_ROW - C.DRONE_MIN_ROW + 1));
    this.state.drone = {
      id: this._id(),
      x: dir > 0 ? -10 : C.WIDTH + 10,
      y: row * C.CELL + 4,
      dir,
      speed:
        this.state.score >= C.DIFFICULTY_SCORE_STEP &&
        this.random() < C.DRONE_FAST_CHANCE
          ? C.DRONE_MAX_SPEED
          : C.DRONE_SPEED,
    };
    this._event("drone-spawn", this.state.drone);
  }
  _moveEnemies() {
    const s = this.state;
    s.timers.crawler -= C.STEP;
    if (!s.crawler && s.timers.crawler <= 0) this._spawnCrawler();
    if (s.crawler) {
      const e = s.crawler;
      e.life += C.STEP;
      e.phase -= C.STEP;
      e.tool = Math.max(0, e.tool - C.STEP);
      const speed = e.speed;
      const minY = this._crawlerMinY();
      if (e.phase <= 0) {
        e.phase = C.CRAWLER_TURN_PERIOD;
        if (this.random() < 0.5 && e.x > 4 && e.x < 236)
          e.vx = e.vx ? 0 : e.dir;
        if (this.random() < 0.5) e.vy *= -1;
      }
      e.x += e.vx * speed * C.STEP;
      e.y += e.vy * speed * C.STEP;
      if (e.y < minY || e.y > C.CRAWLER_MAX_Y) {
        e.y = clamp(e.y, minY, C.CRAWLER_MAX_Y);
        e.vy *= -1;
      }
      const overlap = s.sections.some((part) =>
        part.links.some(
          (link) =>
            Math.abs(link.y - e.y) < 0.01 &&
            (link.x - e.x) * e.dir > 0 &&
            (link.x - e.x) * e.dir < C.CHAIN_OVERLAP_DISTANCE,
        ),
      );
      if (overlap) e.vy *= -1;
      const eaten = this._gearAt(e.x, e.y);
      s.gears = s.gears.filter((g) => {
        if (g === eaten) {
          e.tool = 0.25;
          this._effect("gear-remove", g.x, g.y);
          this._event("gear-remove", { x: g.x, y: g.y });
          return false;
        }
        return true;
      });
      if (e.x < -10 || e.x > C.WIDTH + 10) {
        s.crawler = null;
        s.timers.crawler = C.CRAWLER_SPAWN;
      }
    }
    // Flea and scorpion share the arcade's fourteenth moving-object slot.
    if (
      !s.dispenser &&
      !s.drone &&
      s.mainLength <= C.DRONE_MAX_MAIN_LENGTH &&
      s.frame % C.DRONE_SPAWN_FRAMES === 0 &&
      this.random() < C.DRONE_SPAWN_CHANCE
    )
      this._spawnDrone();
    if (!s.dispenser && !s.drone && s.mainLength < C.CHAIN_LENGTH) {
      const count = s.gears.filter(
        (g) => g.y >= C.DISPENSER_COUNT_MIN_Y,
      ).length;
      const high = Math.floor(s.score / C.SCORE_HIGH_DIGIT_UNIT) % 100;
      const bcd = Math.floor(high / 10) * 16 + (high % 10);
      const threshold =
        s.score < C.DIFFICULTY_SCORE_STEP
          ? C.DISPENSER_GEAR_THRESHOLD
          : s.score < C.DISPENSER_HIGH_THRESHOLD_SCORE
            ? C.DISPENSER_MID_GEAR_THRESHOLD
            : C.DISPENSER_HIGH_THRESHOLD_BASE + Math.floor(bcd / 2);
      if (count <= threshold && s.timers.dispenser <= 0) this._spawnDispenser();
    }
    s.timers.dispenser -= C.STEP;
    if (s.dispenser) {
      const e = s.dispenser;
      e.y += e.speed * C.STEP;
      if (
        s.frame % C.DISPENSER_GEAR_FRAMES === 0 &&
        this.random() < C.DISPENSER_GEAR_CHANCE
      )
        this._addGear(
          Math.floor(e.x / C.CELL),
          Math.floor((e.y - C.DISPENSER_DROP_OFFSET) / C.CELL),
        );
      if (e.y > C.HEIGHT + 8) {
        s.dispenser = null;
        s.timers.dispenser = C.DISPENSER_DELAY;
      }
    }
    if (s.drone) {
      const e = s.drone;
      e.x += e.dir * e.speed * C.STEP;
      const gear = this._gearAt(e.x, e.y);
      if (gear && !gear.electrified) {
        gear.electrified = true;
        this._event("electrify", { x: gear.x, y: gear.y, id: gear.id });
        this._effect("electrify", gear.x, gear.y);
      }
      if (e.x < -12 || e.x > C.WIDTH + 12) s.drone = null;
    }
    if (s.lowerReached && s.sections.length) {
      s.timers.extraHead -= C.STEP;
      if (
        s.timers.extraHead <= 0 &&
        s.sections.reduce((n, p) => n + p.links.length, 0) < C.CHAIN_LENGTH
      ) {
        const dir = this.random() < 0.5 ? 1 : -1;
        const section = this._makeSection(1, dir > 0 ? 4 : 236, 196, dir, {
          added: true,
          fast: true,
          vertical: 1,
        });
        s.sections.push(section);
        s.headsAdded++;
        s.timers.extraHead = Math.max(
          C.MIN_EXTRA_HEAD_DELAY,
          C.EXTRA_HEAD_DELAY -
            s.headsAdded * C.EXTRA_HEAD_PERIOD_DECREASE -
            Math.floor(s.score / C.SCORE_HIGH_DIGIT_UNIT) *
              C.EXTRA_HEAD_SCORE_DECREASE,
        );
        this._event("head-enter", { x: section.links[0].x, y: 196 });
      }
    }
  }
  _hitEnemy(type) {
    const s = this.state,
      e = s[type];
    if (!e) return;
    if (type === "dispenser") {
      e.hp--;
      if (e.hp > 0) {
        e.speed = C.DISPENSER_HIT_SPEED;
        this._event("dispenser-hit", { x: e.x, y: e.y, hp: e.hp });
        this._effect("spark", e.x, e.y);
        return;
      }
    }
    let points = type === "drone" ? C.DRONE_SCORE : C.DISPENSER_SCORE;
    if (type === "crawler") {
      const distance = Math.abs(e.y - s.player.y);
      points =
        distance < C.CRAWLER_NEAR
          ? C.CRAWLER_SCORES[2]
          : distance < C.CRAWLER_MEDIUM
            ? C.CRAWLER_SCORES[1]
            : C.CRAWLER_SCORES[0];
    }
    this._score(points, e.x, e.y);
    this._effect(type + "-destroy", e.x, e.y);
    this._event(type + "-destroy", { x: e.x, y: e.y, points });
    s[type] = null;
    s.timers[type] =
      type === "crawler"
        ? C.CRAWLER_RESPAWN
        : type === "dispenser"
          ? C.DISPENSER_DELAY
          : C.DRONE_SPAWN;
  }
  _checkPlayerCollision() {
    const s = this.state,
      p = s.player;
    const touches = (o, spider = false) => {
      const x = Math.abs(o.x - p.x),
        y = Math.abs(o.y - p.y);
      return x < (spider ? 10 : 7) && y < 7 && x + y < (spider ? 14 : 12);
    };
    for (const section of s.sections)
      for (const link of section.links) {
        if (touches(link)) {
          this._die();
          return;
        }
      }
    if (
      (s.crawler && touches(s.crawler, true)) ||
      (s.dispenser && touches(s.dispenser))
    )
      this._die();
  }

  _die() {
    const s = this.state;
    if (s.mode !== "playing" && s.mode !== "wave") return;
    s.lives--;
    s.mode = "dying";
    s.timer = C.DEATH_DURATION;
    s.bullet = null;
    s.deathAge = 0;
    s.repairQueue = null;
    s.repairDone = false;
    this._effect("player-death", s.player.x, s.player.y, { duration: 1 });
    this._event("player-death", {
      x: s.player.x,
      y: s.player.y,
      lives: s.lives,
    });
  }
  _resetLife() {
    const s = this.state;
    if (s.lives <= 0) {
      s.mode = "gameover";
      this._event("game-over", { score: s.score });
      return;
    }
    s.player = { x: 120, y: C.PLAYER_MAX_Y };
    // A life restarts in a safe free cell; mounted gears remain in the field.
    if (this._gearAt(s.player.x, s.player.y)) {
      const choices = Array.from(
        { length: C.COLS },
        (_, col) => col * C.CELL + 4,
      ).sort((a, b) => Math.abs(a - 120) - Math.abs(b - 120));
      const x = choices.find(
        (x) =>
          !this.state.gears.some(
            (g) => Math.abs(x - g.x) < 6 && Math.abs(s.player.y - g.y) < 6,
          ),
      );
      if (x !== undefined) s.player.x = x;
    }
    if (s.pendingWave) this._advanceWave();
    this._spawnWave();
    s.mode = "playing";
    this._event("life-start", { lives: s.lives });
  }

  /** Deterministic scenarios intentionally bypass normal setup; never used by play.
   * debug('clear'), debug('hitLink',{section:0,index:1}), debug('gear',{col,row,...}),
   * debug('section',{count,x,y,dir,...}), debug('enemy',{type,...}), debug('kill'),
   * debug('score',{points}), debug('wave',{wave}), or debug('scenario',{name}). */
  debug(action, data = {}) {
    const s = this.state;
    if (action === "clear") {
      s.gears = [];
      s.sections = [];
      s.bullet = s.crawler = s.dispenser = s.drone = null;
      s.timers = { crawler: 1e9, dispenser: 1e9, drone: 1e9, extraHead: 1e9 };
      s.lowerReached = false;
      s.mode = "playing";
    } else if (action === "gear") {
      const g = this._addGear(data.col, data.row, false);
      if (g) Object.assign(g, data);
      return g;
    } else if (action === "section") {
      const section = this._makeSection(
        data.count ?? 5,
        data.x ?? 124,
        data.y ?? 84,
        data.dir ?? 1,
        data,
      );
      s.sections.push(section);
      return section;
    } else if (action === "hitLink") {
      const section =
        typeof data.section === "number"
          ? s.sections[data.section]
          : data.section || s.sections[0];
      if (section?.links[data.index ?? 0])
        this._hitLink(section, section.links[data.index ?? 0]);
    } else if (action === "hitGear") {
      const g = data.id
        ? s.gears.find((g) => g.id === data.id)
        : s.gears[data.index ?? 0];
      if (g) this._hitGear(g);
    } else if (action === "enemy") {
      const type = data.type;
      if (type === "crawler") this._spawnCrawler();
      if (type === "dispenser") this._spawnDispenser();
      if (type === "drone") this._spawnDrone();
      Object.assign(s[type], data);
      return s[type];
    } else if (action === "hitEnemy") this._hitEnemy(data.type);
    else if (action === "kill") this._die();
    else if (action === "score") this._score(data.points || 0);
    else if (action === "wave") {
      s.wave = 1;
      s.mainLength = C.CHAIN_LENGTH;
      s.chainSpeed = C.FAST_CHAIN_SPEED;
      while (s.wave < (data.wave || 1)) this._advanceWave();
      this._spawnWave();
    } else if (action === "scenario") this._scenario(data.name);
    return this.inspect();
  }
  _scenario(name) {
    this.start();
    this.debug("clear");
    const s = this.state;
    if (name === "crowded") {
      for (let n = 0; n < 6; n++)
        this.debug("section", {
          count: (n % 3) + 1,
          x: 28 + n * 32,
          y: 212 + (n % 3) * 16,
          dir: n % 2 ? -1 : 1,
          inPlayer: true,
          tailReleased: true,
        });
      for (let n = 0; n < 17; n++)
        this.debug("gear", {
          col: 2 + ((n * 7) % 26),
          row: 24 + (n % 7),
          hp: (n % 4) + 1,
          electrified: n % 4 === 0,
        });
      this.debug("enemy", { type: "crawler", x: 190, y: 216 });
      s.player = { x: 120, y: C.PLAYER_MAX_Y };
    } else if (name === "poison") {
      this.debug("section", { count: 6, x: 100, y: 100 });
      this.debug("gear", { col: 13, row: 12, electrified: true });
    } else if (name === "split")
      this.debug("section", { count: 8, x: 164, y: 116 });
    else if (name === "enemies") {
      this.debug("section", { count: 8, x: 124, y: 36 });
      this.debug("enemy", { type: "crawler", x: 50, y: 212 });
      this.debug("enemy", { type: "dispenser", x: 164, y: 80 });
      this.debug("enemy", { type: "drone", x: 72, y: 100 });
      for (let col = 7; col < 24; col += 2)
        this.debug("gear", { col, row: 12 });
    } else this.debug("section", { count: 12, x: 124, y: 36 });
    this.events = [];
  }
}
export { C };
