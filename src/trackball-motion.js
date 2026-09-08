const WINDOW_MS = 50;
const IDLE_MS = 100;
const FIRST_INTERVAL_MS = 1000 / 60;
const MIN_STROKE = 5;
const MIN_SPEED = 160;
const FULL_SPIN_SPEED = 360;
const MAX_SPEED = 1200;
const STOP_SPEED = 3;
const FRICTION = Math.LN2 / 0.16;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// A free-spinning ball supplements direct pointer displacement. All distances are
// logical game pixels; pointer capture and fixed-step input consumption live in
// Controls, so this class never stores a queue of pointer movement.
export class TrackballMotion {
  constructor() {
    this.velocity = { x: 0, y: 0 };
    this.clear();
  }

  sample(dx, dy, timeStamp, sensitivity = 1.5) {
    dx = Number.isFinite(dx) ? clamp(dx, -4096, 4096) : 0;
    dy = Number.isFinite(dy) ? clamp(dy, -4096, 4096) : 0;
    if (dx === 0 && dy === 0) return;

    const time = Number.isFinite(timeStamp)
      ? clamp(timeStamp, -1e12, 1e12)
      : (this.lastTime ?? 0) + FIRST_INTERVAL_MS;
    let interval =
      this.lastTime === null ? FIRST_INTERVAL_MS : time - this.lastTime;
    if (interval < 0 || interval >= IDLE_MS) {
      this.clear();
      interval = FIRST_INTERVAL_MS;
    }

    const previous = this.samples.at(-1);
    if (previous?.provisional && interval > 0) {
      // The next packet reveals the cadence of a newly started stroke. Refine
      // the initial estimate so a short 120 Hz flick is not diluted by assuming
      // its first packet occupied a whole 60 Hz frame.
      previous.start = previous.end - interval;
      previous.provisional = false;
    }
    const reversing =
      dx * this.velocity.x + dy * this.velocity.y < 0 ||
      (previous && dx * previous.dx + dy * previous.dy < 0);
    if (reversing) {
      // Touching the ball against its rotation brakes it immediately, even for a
      // tiny correction. A new stroke must earn its own launch after that touch.
      this.velocity.x = this.velocity.y = 0;
      this.samples = [];
    }

    let packet = this.samples.at(-1);
    if (interval === 0 && packet?.end === time) {
      // Coarse event clocks can give several packets the same timestamp. Combine
      // them over their existing interval instead of deriving infinite speed.
      packet.dx = clamp(packet.dx + dx, -4096, 4096);
      packet.dy = clamp(packet.dy + dy, -4096, 4096);
    } else {
      packet = {
        dx,
        dy,
        start: time - (interval > 0 ? interval : this.lastInterval),
        end: time,
        provisional: this.lastTime === null,
      };
      this.samples.push(packet);
    }
    this.lastTime = time;
    if (interval > 0) this.lastInterval = interval;

    const instantSpeed =
      (Math.hypot(packet.dx, packet.dy) * 1000) /
      (packet.end - packet.start);
    if (instantSpeed < MIN_SPEED) {
      // Precision positioning acts like resting a hand on the trackball. Old
      // fast samples must not launch the ball again after the correction.
      this.velocity.x = this.velocity.y = 0;
      this.samples = [packet];
      return;
    }

    const cutoff = time - WINDOW_MS;
    this.samples = this.samples
      .filter((sample) => sample.end > cutoff)
      .slice(-128);
    let strokeX = 0;
    let strokeY = 0;
    for (const sample of this.samples) {
      const fraction =
        (sample.end - Math.max(sample.start, cutoff)) /
        (sample.end - sample.start);
      strokeX += sample.dx * fraction;
      strokeY += sample.dy * fraction;
    }
    const duration =
      (time - Math.max(this.samples[0].start, cutoff)) / 1000;
    const distance = Math.hypot(strokeX, strokeY);
    const speed = distance / duration;
    if (distance < MIN_STROKE || speed < MIN_SPEED) {
      this.velocity.x = this.velocity.y = 0;
      return;
    }

    const gain =
      (Number.isFinite(sensitivity) ? clamp(sensitivity, 0, 4) : 1.5) *
      1.5;
    // Ease into spin above the precision range instead of abruptly launching at
    // a threshold. A deliberate fast flick gets the full rolling impulse.
    const engagement = clamp(
      (speed - MIN_SPEED) / (FULL_SPIN_SPEED - MIN_SPEED),
      0,
      1,
    );
    const launchSpeed = Math.min(MAX_SPEED, speed * gain * engagement);
    this.velocity.x = (strokeX / distance) * launchSpeed;
    this.velocity.y = (strokeY / distance) * launchSpeed;
  }

  step(dt, driven = false) {
    if (driven || !Number.isFinite(dt) || dt <= 0) return { dx: 0, dy: 0 };
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (speed <= STOP_SPEED) {
      this.velocity.x = this.velocity.y = 0;
      return { dx: 0, dy: 0 };
    }
    const stopTime = Math.log(speed / STOP_SPEED) / FRICTION;
    const decay = Math.exp(-FRICTION * Math.min(dt, stopTime));
    const distanceFactor = (1 - decay) / FRICTION;
    const result = {
      dx: this.velocity.x * distanceFactor,
      dy: this.velocity.y * distanceFactor,
    };
    if (dt >= stopTime) this.velocity.x = this.velocity.y = 0;
    else {
      this.velocity.x *= decay;
      this.velocity.y *= decay;
    }
    return result;
  }

  stopAxis(axis) {
    if (axis !== "x" && axis !== "y") return;
    this.velocity[axis] = 0;
    // A wall consumes rotation into that wall, including velocity-estimation
    // history, while the other axis can continue rolling along the edge.
    for (const sample of this.samples) sample[`d${axis}`] = 0;
  }

  clear() {
    this.velocity.x = this.velocity.y = 0;
    this.samples = [];
    this.lastTime = null;
    this.lastInterval = FIRST_INTERVAL_MS;
  }
}
