// Keyboard + touch input, normalised into the control vector the physics wants.

const KEY_MAP = {
  ArrowUp: 'throttle', KeyW: 'throttle',
  ArrowDown: 'brake', KeyS: 'brake',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'handbrake',
  ShiftLeft: 'boost', ShiftRight: 'boost'
};

export class Input {
  constructor() {
    this.down = new Set();
    this.taps = new Set();
    this.steer = 0;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const a = KEY_MAP[e.code];
      if (a) { this.down.add(a); e.preventDefault(); }
      this.taps.add(e.code);
    });
    addEventListener('keyup', (e) => {
      const a = KEY_MAP[e.code];
      if (a) { this.down.delete(a); e.preventDefault(); }
    });
    addEventListener('blur', () => this.down.clear());
  }

  /** True once, on the frame the key went down. */
  tapped(code) {
    if (this.taps.has(code)) { this.taps.delete(code); return true; }
    return false;
  }

  endFrame() { this.taps.clear(); }

  /** Smoothly ramped steering so keyboard input doesn't snap the wheel. */
  read(dt, speed) {
    const want = (this.down.has('right') ? 1 : 0) - (this.down.has('left') ? 1 : 0);
    // The faster you go the slower the wheel moves — keeps a bus from flipping.
    const rate = want === 0 ? 7.5 : 4.2 - Math.min(2.4, speed * 0.055);
    this.steer += (want - this.steer) * Math.min(1, rate * dt);
    if (Math.abs(this.steer) < 0.004) this.steer = 0;

    return {
      throttle: this.down.has('throttle') ? 1 : 0,
      brake: this.down.has('brake') ? 1 : 0,
      steer: this.steer,
      handbrake: this.down.has('handbrake') ? 1 : 0,
      boost: this.down.has('boost') ? 1 : 0
    };
  }
}
