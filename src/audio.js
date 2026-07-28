// Everything you hear is synthesised — no audio files in the repo.

const JINGLE = [ // "Turkey in the Straw", the ice cream van standard
  [659, 0.16], [587, 0.16], [494, 0.16], [523, 0.16],
  [587, 0.32], [659, 0.16], [523, 0.16], [587, 0.48],
  [659, 0.16], [587, 0.16], [494, 0.16], [523, 0.16],
  [587, 0.32], [523, 0.32], [440, 0.48]
];

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.started = false;
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.started = true;

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    this.#buildEngine();
    this.#buildTyres();
    this.#buildWind();
  }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
  }

  #buildEngine() {
    const ctx = this.ctx;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    // A little saturation makes the stacked saws sound like combustion.
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.6);
    }
    shaper.curve = curve;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    this.engineFilter = lp;

    this.engineOscs = [];
    for (const [type, mult, gain] of [['sawtooth', 1, 0.5], ['square', 0.5, 0.32], ['sawtooth', 2.01, 0.16]]) {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(shaper);
      o.start();
      this.engineOscs.push({ osc: o, mult });
    }
    shaper.connect(lp).connect(this.engineGain).connect(this.master);
  }

  #buildTyres() {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2100;
    bp.Q.value = 5.5;
    this.tyreFilter = bp;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    src.connect(bp).connect(this.tyreGain).connect(this.master);
    src.start();
  }

  #buildWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(lp).connect(this.windGain).connect(this.master);
    src.start();
  }

  /** Per-frame engine/tyre state. */
  update({ rpm, load, speed, slip, note = 1, boosting = false }) {
    if (!this.started || !this.enabled) return;
    const t = this.ctx.currentTime;

    const base = (60 + rpm * 150) * note;
    for (const { osc, mult } of this.engineOscs) {
      osc.frequency.setTargetAtTime(base * mult, t, 0.04);
    }
    this.engineFilter.frequency.setTargetAtTime(700 + rpm * 2600 + (boosting ? 900 : 0), t, 0.06);
    this.engineGain.gain.setTargetAtTime(0.075 + load * 0.11 + (boosting ? 0.05 : 0), t, 0.06);

    this.tyreGain.gain.setTargetAtTime(Math.min(0.2, Math.max(0, slip - 0.22) * 0.42), t, 0.05);
    this.tyreFilter.frequency.setTargetAtTime(1500 + slip * 1800, t, 0.05);
    this.windGain.gain.setTargetAtTime(Math.min(0.12, speed / 60 * 0.12), t, 0.1);
  }

  silence() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0, t, 0.08);
    this.tyreGain.gain.setTargetAtTime(0, t, 0.08);
    this.windGain.gain.setTargetAtTime(0, t, 0.08);
  }

  // -- one-shots ------------------------------------------------------------

  crash(strength = 1) {
    if (!this.started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 0.32);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.6, 0.18 + strength * 0.35), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.45);
  }

  beep(freq = 440, duration = 0.16, type = 'square', gain = 0.16) {
    if (!this.started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.02);
  }

  /** The ice cream van's calling card. Also plays when it uses nitrous. */
  jingle(speedUp = 1) {
    if (!this.started || !this.enabled || this.jinglePlaying) return;
    this.jinglePlaying = true;
    const ctx = this.ctx;
    let t = ctx.currentTime + 0.02;
    for (const [freq, dur] of JINGLE) {
      const d = dur / speedUp;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + d * 0.95);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + d);
      t += d;
    }
    setTimeout(() => { this.jinglePlaying = false; }, (t - ctx.currentTime) * 1000);
  }

  /** Double decker air brakes. */
  airBrake() {
    if (!this.started || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.55);
  }
}
