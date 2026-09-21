/**
 * Original, asset-free mechanical sound design. Call unlock() from a user gesture;
 * update() accepts the simulation state and never changes it. Audio time is kept
 * separate from simulation time, so test time advancement cannot queue a backlog.
 */
export class MechanicalAudio {
  constructor({ muted = false, volume = 0.45 } = {}) {
    this.muted = Boolean(muted);
    this.volume = this._clampVolume(volume);
    this.context = null;
    this.master = null;
    this.voices = new Set();
    this.lastEvents = new Map();
    this.nextAmbient = {
      chain: 0,
      gantry: 0,
      dispenser: 0,
      flywheel: 0,
      electric: 0,
    };
    this.phase = 0;
    this.isPlaying = false;
    this.available = Boolean(
      globalThis.AudioContext || globalThis.webkitAudioContext,
    );
    this._unlocking = null;
  }

  _clampVolume(value) {
    return Number.isFinite(Number(value))
      ? Math.min(1, Math.max(0, Number(value)))
      : 0.45;
  }

  /** Returns false gracefully when the browser cannot activate Web Audio. */
  async unlock() {
    if (this._unlocking) return this._unlocking;
    this._unlocking = this._unlock();
    try {
      return await this._unlocking;
    } finally {
      this._unlocking = null;
    }
  }

  async _unlock() {
    try {
      if (!this.context) {
        const AudioContext =
          globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) return false;
        this.context = new AudioContext({ latencyHint: "interactive" });
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume * 0.48;
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -13;
        limiter.knee.value = 10;
        limiter.ratio.value = 8;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.09;
        this.master.connect(limiter);
        limiter.connect(this.context.destination);
        this._makeNoise();
      }
      if (
        this.context.state === "suspended" ||
        this.context.state === "interrupted"
      )
        await this.context.resume();
      // Safari can require a source to start during the activating gesture.
      const primer = this.context.createBufferSource();
      primer.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
      primer.connect(this.master);
      primer.onended = () => primer.disconnect();
      primer.start();
      const running = this.context.state === "running";
      if (running) this.available = true;
      return running;
    } catch {
      this.available = false;
      return false;
    }
  }

  _makeNoise() {
    const length = this.context.sampleRate;
    this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = this.noise.getChannelData(0);
    // A private deterministic source avoids disturbing seeded gameplay RNG.
    let seed = 0x16b67a21;
    for (let i = 0; i < length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      data[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this._setGain();
    if (this.muted) this.stop();
    return this.muted;
  }

  setVolume(volume) {
    this.volume = this._clampVolume(volume);
    this._setGain();
    return this.volume;
  }

  _setGain() {
    if (!this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(
      this.muted ? 0 : this.volume * 0.48,
      now,
      0.015,
    );
  }

  _ready() {
    return this.context?.state === "running" && !this.muted && this.volume > 0;
  }

  _voice(source, nodes, gain, duration, when, ambient) {
    if (this.voices.size >= 48) {
      for (const voice of this.voices) {
        if (voice.ambient) {
          this._endVoice(voice);
          break;
        }
      }
      if (this.voices.size >= 48) {
        source.disconnect();
        for (const node of nodes) node.disconnect();
        return;
      }
    }
    const voice = { source, nodes, gain, ambient };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect();
      for (const node of nodes) node.disconnect();
      this.voices.delete(voice);
    };
    source.start(when);
    source.stop(when + duration + 0.018);
  }

  _envelope(gain, when, duration, level, attack = 0.003) {
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, level),
      when + attack,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  }

  _tone(frequency, duration, level, options = {}) {
    if (!this._ready()) return;
    const {
      end = frequency,
      delay = 0,
      type = "sine",
      ambient = false,
      attack = 0.003,
    } = options;
    const now = this.context.currentTime + delay;
    const source = this.context.createOscillator();
    const gain = this.context.createGain();
    source.type = type;
    source.frequency.setValueAtTime(frequency, now);
    if (end !== frequency)
      source.frequency.exponentialRampToValueAtTime(
        Math.max(12, end),
        now + duration,
      );
    this._envelope(gain, now, duration, level, attack);
    source.connect(gain);
    gain.connect(this.master);
    this._voice(source, [gain], gain, duration, now, ambient);
  }

  _noise(duration, level, options = {}) {
    if (!this._ready()) return;
    const {
      frequency = 1700,
      q = 0.8,
      type = "bandpass",
      delay = 0,
      ambient = false,
    } = options;
    const now = this.context.currentTime + delay;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noise;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    this._envelope(gain, now, duration, level);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    this._voice(source, [filter, gain], gain, duration, now, ambient);
  }

  _metal(base, duration, level, options = {}) {
    this._tone(base, duration, level, options);
    this._tone(base * 1.483, duration * 0.7, level * 0.43, options);
    this._tone(base * 2.137, duration * 0.44, level * 0.2, options);
  }

  /** Accepts either 'linkBreak' or an engine event such as {type:'linkBreak'}. */
  play(event) {
    if (!this._ready()) return;
    let type = typeof event === "string" ? event : event?.type || event?.name;
    type = type?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const aliases = {
      fire: "shot",
      shoot: "shot",
      mushroomHit: "gearHit",
      mushroomDestroyed: "gearBreak",
      gearDestroy: "gearBreak",
      gearDestroyed: "gearBreak",
      segmentDestroyed: "linkBreak",
      linkDestroy: "linkBreak",
      linkDestroyed: "linkBreak",
      headActivated: "headActivate",
      death: "playerDeath",
      life: "extraLife",
      fleaHit: "dispenserHit",
      fleaDeath: "dispenserDeath",
      poison: "electrify",
      wave: "waveStart",
      gantryDestroy: "gantryDeath",
      dispenserDestroy: "dispenserDeath",
      flywheelDestroy: "flywheelDeath",
      headEnter: "headActivate",
    };
    type = aliases[type] || type;
    const now = this.context.currentTime;
    const interval =
      {
        shot: 0.035,
        gearHit: 0.035,
        linkBreak: 0.03,
        headActivate: 0.045,
        electrify: 0.15,
      }[type] ?? 0.05;
    if (now - (this.lastEvents.get(type) ?? -10) < interval) return;
    this.lastEvents.set(type, now);
    switch (type) {
      case "shot":
        this._noise(0.034, 0.18, { frequency: 2300, q: 1.4 });
        this._tone(1220, 0.07, 0.105, { end: 410, type: "triangle" });
        break;
      case "gearHit":
        this._metal(840, 0.12, 0.15);
        this._noise(0.024, 0.1, { frequency: 4000 });
        break;
      case "gearBreak":
        this._metal(213, 0.25, 0.26);
        this._noise(0.11, 0.3, { frequency: 880 });
        this._metal(730, 0.12, 0.065, { delay: 0.06 });
        break;
      case "linkBreak":
        this._noise(0.075, 0.47, { frequency: 2850, q: 0.75 });
        this._metal(590, 0.19, 0.25);
        this._tone(190, 0.065, 0.21, { end: 70, type: "triangle" });
        break;
      case "headActivate":
        this._tone(78, 0.19, 0.065, {
          end: 340,
          type: "sawtooth",
          attack: 0.008,
        });
        this._metal(1320, 0.055, 0.07, { delay: 0.055 });
        break;
      case "gantryDeath":
        this._tone(240, 0.28, 0.21, { end: 43, type: "triangle" });
        this._noise(0.21, 0.3, { frequency: 650 });
        this._metal(430, 0.19, 0.2, { delay: 0.035 });
        break;
      case "dispenserHit":
        this._metal(1180, 0.12, 0.21);
        this._tone(160, 0.11, 0.08, { end: 470, type: "sawtooth" });
        break;
      case "dispenserDeath":
        this._metal(440, 0.18, 0.22);
        this._metal(660, 0.13, 0.12, { delay: 0.055 });
        this._noise(0.14, 0.2, { frequency: 2100 });
        break;
      case "flywheelDeath":
        this._tone(680, 0.37, 0.085, { end: 70, type: "sawtooth" });
        this._noise(0.17, 0.3, { frequency: 3900 });
        this._metal(310, 0.24, 0.2, { delay: 0.09 });
        break;
      case "electrify":
        this._electric(false);
        break;
      case "gantryWarning":
        this._tone(740, 0.13, 0.10, { type: "square", end: 680 });
        this._tone(740, 0.13, 0.08, { type: "square", delay: 0.25 });
        break;
      case "gantryStrike":
        this._noise(0.18, 0.24, { frequency: 1350, q: 0.5 });
        this._tone(180, 0.17, 0.08, { type: "sawtooth", end: 65 });
        break;
      case "gantryImpact":
        this._metal(125, 0.22, 0.25);
        this._noise(0.05, 0.2, { frequency: 450 });
        break;
      case "gantryHit":
        this._metal(940, 0.12, 0.2);
        this._noise(0.08, 0.12, { frequency: 2300 });
        break;
      case "gantrySpawn":
        this._tone(130, 0.18, 0.09, { end: 66, type: "triangle" });
        this._metal(310, 0.09, 0.065, { delay: 0.08 });
        break;
      case "dispenserSpawn":
        this._metal(1720, 0.065, 0.07);
        this._metal(1140, 0.075, 0.065, { delay: 0.075 });
        break;
      case "gearKnock":
        this._metal(190, 0.24, 0.28);
        this._metal(810, 0.16, 0.11, { delay: 0.035 });
        this._noise(0.08, 0.18, { frequency: 650 });
        break;
      case "flywheelSpawn":
        this._tone(74, 0.2, 0.04, {
          end: 158,
          type: "sawtooth",
          attack: 0.012,
        });
        this._metal(480, 0.16, 0.09);
        break;
      case "playerDeath":
        this.stop(true);
        this._noise(0.3, 0.58, { frequency: 1050 });
        this._metal(147, 0.7, 0.35);
        this._tone(430, 0.65, 0.105, { end: 29, type: "sawtooth" });
        this._metal(790, 0.24, 0.09, { delay: 0.11 });
        break;
      case "extraLife":
        [440, 660, 880, 1320].forEach((f, i) => {
          this._metal(f, 0.27, 0.13, { delay: i * 0.09 });
        });
        break;
      case "waveStart":
        this._tone(55, 0.3, 0.08, { end: 190, type: "sawtooth" });
        this._metal(660, 0.2, 0.12, { delay: 0.05 });
        this._metal(990, 0.23, 0.13, { delay: 0.16 });
        break;
      case "gameOver":
        this.stop(true);
        [330, 247, 165].forEach((f, i) => {
          this._metal(f, 0.45, 0.2, { delay: i * 0.23 });
          this._tone(f / 2, 0.28, 0.055, {
            end: f / 3,
            type: "triangle",
            delay: i * 0.23,
          });
        });
        break;
      default:
        break;
    }
  }

  _electric(ambient) {
    const level = ambient ? 0.065 : 0.18;
    this._noise(0.04, level, { frequency: 4100, q: 1.2, ambient });
    this._noise(0.024, level * 0.7, { frequency: 2600, delay: 0.038, ambient });
    this._tone(92, 0.08, level * 0.18, { type: "sawtooth", ambient });
  }

  _present(enemy) {
    if (Array.isArray(enemy))
      return enemy.some(
        (item) => item && item.active !== false && item.alive !== false,
      );
    return Boolean(enemy && enemy.active !== false && enemy.alive !== false);
  }

  /** Ambient audio uses live entities, without timers that survive pause or death. */
  update(state = {}) {
    const status = state.status ?? state.mode ?? state.phase;
    const active =
      !state.paused &&
      (status === "playing" ||
        status === "wave" ||
        status === "running" ||
        status === "active");
    if (!active) {
      if (this.isPlaying) this.stop(true);
      this.isPlaying = false;
      return;
    }
    this.isPlaying = true;
    if (!this._ready()) return;
    const now = this.context.currentTime;
    const chains = state.chains ?? state.sections ?? [];
    const links = state.links ?? state.segments ?? [];
    const hasChain = Array.isArray(chains)
      ? chains.length > 0 || links.length > 0
      : Boolean(chains);
    const chainSpeed = state.chainSpeed ?? state.speed ?? 90;
    const chatterInterval = Math.max(
      0.095,
      Math.min(0.2, 0.185 - Math.max(0, chainSpeed - 75) * 0.0003),
    );
    if (hasChain && now >= this.nextAmbient.chain) {
      this.nextAmbient.chain = now + chatterInterval;
      this.phase++;
      this._metal(this.phase % 2 ? 340 : 420, 0.04, 0.037, { ambient: true });
      this._noise(0.018, 0.026, { frequency: 1450, ambient: true });
    }
    if (
      this._present(state.gantry) && state.gantry.phase === "travel" &&
      now >= this.nextAmbient.gantry
    ) {
      this.nextAmbient.gantry = now + 0.3;
      this._tone(82, 0.095, 0.07, { end: 53, type: "triangle", ambient: true });
      this._noise(0.065, 0.07, { frequency: 720, ambient: true });
      this._metal(370, 0.047, 0.03, { delay: 0.083, ambient: true });
    }
    if (
      this._present(state.dispenser ?? state.flea ?? state.dispensers) &&
      now >= this.nextAmbient.dispenser
    ) {
      this.nextAmbient.dispenser = now + 0.24;
      this._metal(1560, 0.045, 0.033, { ambient: true });
      this._metal(980, 0.039, 0.025, { delay: 0.065, ambient: true });
      this._tone(145, 0.08, 0.028, {
        end: 220,
        type: "triangle",
        ambient: true,
      });
    }
    if (
      this._present(state.flywheel) &&
      now >= this.nextAmbient.flywheel
    ) {
      this.nextAmbient.flywheel = now + 0.39;
      this._tone(121, 0.16, 0.022, {
        end: 139,
        type: "sawtooth",
        ambient: true,
        attack: 0.016,
      });
      this._noise(0.068, 0.07, {
        frequency: 3600,
        q: 2.4,
        delay: 0.07,
        ambient: true,
      });
    }
    const charged =
      state.electrified ||
      state.poisoned ||
      (Array.isArray(chains) &&
        chains.some(
          (chain) => chain.poisoned || chain.electrified || chain.diving,
        )) ||
      (Array.isArray(links) &&
        links.some((link) => link.poisoned || link.electrified || link.diving));
    if (charged && now >= this.nextAmbient.electric) {
      this.nextAmbient.electric = now + 0.58;
      this._electric(true);
    }
  }

  _endVoice(voice) {
    const now = this.context.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0.0001, now, 0.004);
      voice.source.stop(now + 0.02);
    } catch {
      /* A naturally ended source is already silent. */
    }
    this.voices.delete(voice);
  }

  /** ambientOnly preserves death, extra-life, and transition cues. */
  stop(ambientOnly = false) {
    if (!this.context) return;
    for (const voice of this.voices) {
      if (!ambientOnly || voice.ambient) this._endVoice(voice);
    }
    for (const key of Object.keys(this.nextAmbient)) this.nextAmbient[key] = 0;
  }

  async suspend() {
    this.stop();
    if (!this.context || this.context.state === "closed") return;
    try {
      await this.context.suspend();
    } catch {
      /* Page teardown can close audio. */
    }
  }

  async resume() {
    return this.unlock();
  }
}
