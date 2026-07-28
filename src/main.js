// Claude for Speed — Hong Kong.
// Boot, scene assembly, race state machine and the render loop.

import * as THREE from 'three';
import { Track } from './track.js';
import { City } from './city.js';
import { VEHICLES, getVehicle, buildModel } from './vehicles.js';
import { createBody, step, clampToTrack, resolveCarCollision, speed, forwardVector, rightVector } from './physics.js';
import { createDriver, driveAI, driverName } from './ai.js';
import { Effects } from './effects.js';
import { Minimap } from './minimap.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { UI, DIFFICULTIES, formatTime } from './ui.js';

const FIXED_DT = 1 / 120;
const CAMERAS = ['chase', 'hood', 'cinematic'];
const NEUTRAL_INPUT = { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: 0 };

class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.4, 3000);
    this.cameraMode = 0;
    this.camShake = 0;
    this.camLook = new THREE.Vector3();

    this.lastTime = performance.now() / 1000;
    this.elapsed = 0;
    this.accumulator = 0;
    this.state = 'garage';
    this.cars = [];
    this.paused = false;

    this.input = new Input();
    this.audio = new Audio();

    this.#buildWorld();
    this.#buildPreview();

    this.ui = new UI(document.getElementById('ui'), {
      onStart: (cfg) => this.startRace(cfg),
      onGarage: () => this.toGarage(),
      onResume: () => this.setPaused(false),
      onPreview: (id) => this.setPreview(id)
    });
    this.minimap = new Minimap(document.getElementById('minimap'), this.track);

    addEventListener('resize', () => this.resize());
    this.resize();

    // The audio graph can only be created from a gesture.
    const unlock = () => { this.audio.start(); this.audio.resume(); };
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });

    this.renderer.setAnimationLoop(() => this.frame());

    // Handy for poking at the running game from the console.
    window.cfs = this;
  }

  // -- world ---------------------------------------------------------------
  #buildWorld() {
    this.scene = new THREE.Scene();
    // Humid daytime haze — the far side of the harbour should fade out.
    this.scene.fog = new THREE.FogExp2(0xc3dcec, 0.00085);

    this.scene.add(buildSky());

    // Metals sample the environment, not the lights — without this every
    // chrome bumper and the whole harbour render pure black.
    const pmremScene = new THREE.Scene();
    pmremScene.add(buildSky());
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(pmremScene, 0, 1, 2400).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0xbcd9f2, 0x6d6656, 0.55));
    const sun = new THREE.DirectionalLight(0xfff3d8, 1.55);
    sun.position.copy(SUN_DIR).multiplyScalar(600);
    this.scene.add(sun);
    // A dim bounce from the opposite side so shaded flanks aren't flat black.
    const bounce = new THREE.DirectionalLight(0xbdd2e8, 0.22);
    bounce.position.copy(SUN_DIR).multiplyScalar(-500).setY(180);
    this.scene.add(bounce);

    this.track = new Track();
    this.scene.add(this.track.build());

    this.city = new City(this.track);
    this.scene.add(this.city.group);

    this.effects = new Effects(this.scene);

    this.blobGeo = new THREE.CircleGeometry(1, 20);
    this.blobGeo.rotateX(-Math.PI / 2);
    this.blobMat = new THREE.MeshBasicMaterial({
      color: 0x101820, transparent: true, opacity: 0.28, depthWrite: false
    });
  }

  #buildPreview() {
    this.previewScene = new THREE.Scene();
    // Same sky as the circuit, so the garage feels like the same afternoon.
    this.previewScene.add(buildSky());
    this.previewCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 4000);

    this.previewScene.add(new THREE.HemisphereLight(0xbcd9f2, 0x7a7364, 0.8));
    const key = new THREE.DirectionalLight(0xfff4e0, 1.9);
    key.position.set(6, 9, 8);
    this.previewScene.add(key);
    const rim = new THREE.DirectionalLight(0xcfe4ff, 0.7);
    rim.position.set(-8, 5, -7);
    this.previewScene.add(rim);

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(9, 9, 0.4, 48),
      new THREE.MeshStandardMaterial({ color: 0x3d4450, roughness: 0.4, metalness: 0.3 })
    );
    disc.position.y = -0.22;
    this.previewScene.add(disc);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(9.1, 0.06, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0xff2d78 })
    );
    ring.rotation.x = Math.PI / 2;
    this.previewScene.add(ring);

    this.previewScene.environment = this.scene.environment;
    this.previewScene.environmentIntensity = 0.5;

    this.previewPivot = new THREE.Group();
    this.previewScene.add(this.previewPivot);
    this.previewId = null;
  }

  setPreview(id) {
    if (this.previewId === id) return;
    this.previewId = id;
    this.previewPivot.clear();
    const def = getVehicle(id);
    const model = buildModel(def);
    this.previewPivot.add(model);
    this.previewDef = def;
  }

  // -- race setup ----------------------------------------------------------
  startRace(cfg) {
    this.audio.start();
    this.audio.resume();
    this.config = cfg;
    this.state = cfg.mode === 'roam' ? 'racing' : 'countdown';
    this.countdown = 3.99;
    this.raceTime = 0;
    this.paused = false;
    this.finishOrder = [];

    for (const car of this.cars) {
      this.scene.remove(car.model);
      this.scene.remove(car.blob);
    }
    this.cars = [];
    this.effects.reset();

    const playerDef = getVehicle(cfg.vehicle);
    const skill = DIFFICULTIES.find((d) => d.id === cfg.difficulty)?.skill ?? 0.94;

    // Grid: the player, then one of each other Hong Kong vehicle.
    const field = [playerDef];
    if (cfg.mode === 'race') {
      const others = VEHICLES.filter((v) => v.id !== playerDef.id);
      field.push(...others, others[Math.floor(Math.random() * others.length)]);
    }

    field.forEach((def, i) => {
      const slot = this.track.gridSlot(i);
      const car = this.#createCar(def, i, i === 0, slot, skill);
      this.cars.push(car);
    });

    this.player = this.cars[0];
    this.totalLaps = cfg.mode === 'roam' ? Infinity : cfg.laps;

    this.hintsFaded = false;
    this.ui.showRace(`${playerDef.zh} ${playerDef.en}`);
    this.ui.countdown(null);
    if (cfg.mode === 'roam') this.ui.toast('Free roam', '自由行', 2200);

    // Snap the camera behind the grid immediately.
    this.#updateCamera(0.999, true);
  }

  #createCar(def, index, isPlayer, slot, skill) {
    const model = buildModel(def, isPlayer ? null : index * 0.17);
    this.scene.add(model);

    const blob = new THREE.Mesh(this.blobGeo, this.blobMat);
    blob.scale.set(def.spec.width * 0.62, 1, def.spec.length * 0.46);
    this.scene.add(blob);

    const body = createBody(def.spec, slot.position, slot.yaw);
    const near = this.track.nearest(body.pos);
    const startS = this.#arcFromStart(near.arc);

    const car = {
      def, model, blob, body, isPlayer,
      parts: model.userData,
      near,
      driver: isPlayer ? null : createDriver(index * 977 + 13, skill + (index - 2) * 0.012),
      name: isPlayer ? 'You' : driverName(index - 1).en,
      zh: isPlayer ? '你' : driverName(index - 1).zh,
      color: isPlayer ? '#ffffff' : def.tint,
      lapsCompleted: -1,
      lastS: startS,
      progress: -this.track.length + startS,
      lapStart: 0,
      lapTimes: [],
      bestLap: 0,
      lastLap: 0,
      finished: false,
      finishTime: 0,
      position: index + 1
    };

    this.#syncModel(car, 0);
    return car;
  }

  #arcFromStart(arc) {
    const start = this.track.arc[this.track.startIndex];
    return (arc - start + this.track.length) % this.track.length;
  }

  toGarage() {
    this.state = 'garage';
    this.paused = false;
    this.audio.silence();
    for (const car of this.cars) {
      this.scene.remove(car.model);
      this.scene.remove(car.blob);
    }
    this.cars = [];
    this.player = null;
    this.ui.showGarage();
  }

  setPaused(on) {
    if (this.state === 'garage') return;
    this.paused = on;
    this.ui.setPaused(on);
    if (on) this.audio.silence();
  }

  // -- loop ----------------------------------------------------------------
  frame() {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - this.lastTime);
    this.lastTime = now;
    this.elapsed += dt;

    if (this.state === 'garage') {
      this.previewPivot.rotation.y += dt * 0.35;
      const t = this.elapsed;
      const def = this.previewDef ?? VEHICLES[0];
      const r = 6 + def.spec.length * 1.5;
      const cam = this.previewCamera;
      cam.position.set(Math.sin(t * 0.12) * 1.5, 2.4 + def.spec.height * 0.55, r);
      // Aim left of the vehicle so it lands in the clear half of the screen,
      // beside the garage panel rather than behind it.
      const halfWidth = r * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect;
      const shift = window.innerWidth > 900 ? halfWidth * 0.36 : 0;
      cam.lookAt(-shift, def.spec.height * 0.42, 0);
      this.renderer.render(this.previewScene, this.previewCamera);
      this.input.endFrame();
      return;
    }

    this.#hotkeys();

    if (!this.paused) {
      if (this.state === 'countdown') this.#tickCountdown(dt);
      this.accumulator = Math.min(0.25, this.accumulator + dt);
      while (this.accumulator >= FIXED_DT) {
        this.#simulate(FIXED_DT);
        this.accumulator -= FIXED_DT;
      }
      if (this.state === 'racing') {
      this.raceTime += dt;
      if (!this.hintsFaded && this.player && speed(this.player.body) > 14) {
        this.hintsFaded = true;
        this.ui.softenHints();
      }
    }
      this.city.update(dt);
      this.effects.update(dt);
      for (const car of this.cars) this.#syncModel(car, dt);
      this.#spawnEffects(dt);
      this.#updateAudio();
    }

    this.#updateCamera(dt, false);
    this.#updateHud();
    this.minimap.draw(this.cars, this.player);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  #hotkeys() {
    if (this.input.tapped('KeyP') || this.input.tapped('Escape')) this.setPaused(!this.paused);
    if (this.input.tapped('KeyC')) this.cameraMode = (this.cameraMode + 1) % CAMERAS.length;
    if (this.input.tapped('KeyM')) {
      this.audio.setEnabled(!this.audio.enabled);
      this.ui.toast(this.audio.enabled ? 'Sound on' : 'Sound off', '', 900);
    }
    if (this.input.tapped('KeyR') && this.player) this.#respawn(this.player);
    if (this.input.tapped('KeyH')) this.ui.cycleHints();
  }

  #respawn(car) {
    const near = this.track.nearest(car.body.pos, car.near.index);
    const p = this.track.offsetPoint(near.index + 4, THREE.MathUtils.clamp(near.lateral, -6, 6));
    const t = this.track.tangentAt(near.index + 4);
    car.body.pos.copy(p);
    car.body.yaw = Math.atan2(t.x, t.z);
    car.body.u = Math.min(car.body.u, 8);
    car.body.w = 0;
    car.body.r = 0;
    car.body.lean = 0;
    this.ui.toast('Back on track', '返回賽道', 1100);
  }

  #tickCountdown(dt) {
    const before = Math.ceil(this.countdown);
    this.countdown -= dt;
    const now = Math.ceil(this.countdown);
    if (now !== before) {
      if (now > 0) { this.ui.countdown(String(now)); this.audio.beep(520, 0.14); }
    }
    if (this.countdown <= 0) {
      this.state = 'racing';
      this.raceTime = 0;
      this.ui.countdown('GO!');
      this.audio.beep(880, 0.4, 'square', 0.2);
      setTimeout(() => this.ui.countdown(null), 700);
      for (const car of this.cars) car.lapStart = 0;
    }
  }

  // -- simulation ----------------------------------------------------------
  #simulate(dt) {
    const racing = this.state === 'racing';

    for (const car of this.cars) {
      let input = NEUTRAL_INPUT;
      if (!racing) {
        // Locked on the grid — blip the throttle but go nowhere.
        input = NEUTRAL_INPUT;
      } else if (car.isPlayer) {
        input = car.finished ? { ...NEUTRAL_INPUT, brake: 0.4 } : this.input.read(dt, speed(car.body));
      } else {
        const rubber = this.#rubberBand(car);
        input = driveAI(car, this.track, this.cars, dt, car.finished ? 0.75 : rubber);
      }
      car.input = input;
      step(car.body, input, dt);
    }

    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const hit = resolveCarCollision(this.cars[i].body, this.cars[j].body);
        if (hit > 0.25 && (this.cars[i].isPlayer || this.cars[j].isPlayer)) this.audio.crash(hit * 0.5);
      }
    }

    for (const car of this.cars) {
      const res = clampToTrack(car.body, this.track, car.near.index);
      car.near = res.near;
      if (res.impact > 3 && car.isPlayer) {
        this.audio.crash(Math.min(1, res.impact / 14));
        this.camShake = Math.min(1, this.camShake + res.impact / 25);
      }
      this.#trackProgress(car, dt);
    }
  }

  /** Nudge AI pace toward the player so a bus race stays a race. */
  #rubberBand(car) {
    if (!this.player || this.config.mode !== 'race') return 1;
    const gap = this.player.progress - car.progress;   // >0 = AI is behind
    return THREE.MathUtils.clamp(1 + gap * 0.0016, 0.9, 1.12);
  }

  #trackProgress(car, dt) {
    const s = this.#arcFromStart(car.near.arc);
    const half = this.track.length * 0.5;
    const delta = s - car.lastS;

    if (delta < -half) {          // crossed the line going forwards
      car.lapsCompleted += 1;
      this.#onLapComplete(car);
    } else if (delta > half) {    // reversed back over it
      car.lapsCompleted -= 1;
    }
    car.lastS = s;
    car.progress = car.lapsCompleted * this.track.length + s;
  }

  #onLapComplete(car) {
    if (this.state !== 'racing') return;

    if (car.lapsCompleted > 0) {
      const lap = this.raceTime - car.lapStart;
      car.lastLap = lap;
      car.lapTimes.push(lap);
      if (!car.bestLap || lap < car.bestLap) car.bestLap = lap;
      if (car.isPlayer) {
        const best = lap === car.bestLap;
        this.ui.toast(`Lap ${car.lapsCompleted} — ${formatTime(lap)}`, best ? '最快一圈' : '完成一圈', 2000);
        this.audio.beep(best ? 1046 : 660, 0.18);
      }
    }
    car.lapStart = this.raceTime;

    if (car.lapsCompleted >= this.totalLaps && !car.finished) {
      car.finished = true;
      car.finishTime = this.raceTime;
      this.finishOrder.push(car);
      if (car.isPlayer) this.#finishRace();
    } else if (car.isPlayer && this.totalLaps !== Infinity &&
               car.lapsCompleted === this.totalLaps - 1 && car.lapsCompleted >= 0) {
      this.ui.toast('Final lap', '最後一圈', 2200);
      this.audio.beep(784, 0.22);
    }
  }

  #finishRace() {
    this.state = 'finished';
    this.audio.silence();

    const ranked = this.#standings();
    const rows = ranked.map((car, i) => ({
      pos: i + 1,
      name: `${car.name} · ${car.def.en}`,
      zh: car.zh,
      me: car.isPlayer,
      time: car.finished ? formatTime(car.finishTime)
        : car.bestLap ? `best ${formatTime(car.bestLap)}` : 'DNF'
    }));

    const place = ranked.findIndex((c) => c.isPlayer) + 1;
    const title = this.config.mode === 'time'
      ? `Best lap ${formatTime(this.player.bestLap)}`
      : place === 1 ? 'You win' : `Finished P${place}`;
    const zh = this.config.mode === 'time' ? '計時賽' : place === 1 ? '冠軍' : '完賽';

    this.audio.beep(place === 1 ? 1318 : 523, 0.5, 'triangle', 0.2);
    if (place === 1 && this.player.def.id === 'icecream') this.audio.jingle(1.3);

    setTimeout(() => this.ui.showResults(title, zh, rows), 900);
  }

  #standings() {
    return [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
  }

  // -- presentation --------------------------------------------------------
  #syncModel(car, dt) {
    const b = car.body;
    car.model.position.set(b.pos.x, 0, b.pos.z);
    car.model.rotation.set(0, b.yaw, 0);

    const shell = car.parts.group;
    shell.rotation.z = b.lean;
    shell.rotation.x = b.pitch;
    // Suspension: the body settles a touch under load.
    shell.position.y = -Math.abs(b.lean) * 0.25;

    for (const w of car.parts.wheels) w.rotation.x = b.wheelSpin;
    for (const w of car.parts.steerWheels) w.rotation.y = b.steer;

    const braking = (car.input?.brake ?? 0) > 0.05 || (car.input?.handbrake ?? 0) > 0.5;
    for (const m of car.parts.brakes) m.emissiveIntensity = braking ? 2.4 : 0.35;

    car.blob.position.set(b.pos.x, 0.03, b.pos.z);
    car.blob.rotation.y = b.yaw;

    if (car.parts.swirl) car.parts.swirl.rotation.y += dt * (1 + speed(b) * 0.1);
  }

  #spawnEffects(dt) {
    for (const car of this.cars) {
      const b = car.body;
      const spd = speed(b);
      const f = forwardVector(b.yaw);
      const r = rightVector(b.yaw);
      const rearZ = -b.spec.wheelbase * 0.45;

      const sliding = b.slip > 0.24 || ((car.input?.handbrake ?? 0) > 0.5 && spd > 4);
      if (sliding && spd > 3) {
        const len = Math.max(0.6, spd * dt * 1.6);
        for (const side of [-1, 1]) {
          const x = b.pos.x + f.x * rearZ + r.x * side * b.spec.width * 0.42;
          const z = b.pos.z + f.z * rearZ + r.z * side * b.spec.width * 0.42;
          this.effects.emitSkid(x, z, b.yaw, 0.34, len);
          if (b.slip > 0.42 && Math.random() < 0.55) {
            this.effects.emitParticle(
              x, 0.25, z,
              (Math.random() - 0.5) * 2 - f.x * spd * 0.08, 0.6 + Math.random(),
              (Math.random() - 0.5) * 2 - f.z * spd * 0.08,
              SMOKE, 1.1, 0.9 + Math.random() * 0.6
            );
          }
        }
      }

      if (b.boosting && Math.random() < 0.8) {
        const c = BOOST_COLORS[car.def.id] ?? BOOST_COLORS.taxi;
        const x = b.pos.x - f.x * b.spec.length * 0.5;
        const z = b.pos.z - f.z * b.spec.length * 0.5;
        this.effects.emitParticle(
          x, 0.45 + Math.random() * 0.5, z,
          -f.x * 5 + (Math.random() - 0.5) * 2, 0.8 + Math.random(),
          -f.z * 5 + (Math.random() - 0.5) * 2,
          c, 0.9, 0.5 + Math.random() * 0.4, 1.6
        );
      }
    }

    // The ice cream van announces its own nitrous.
    if (this.player?.body.boosting && this.player.def.id === 'icecream') this.audio.jingle(1.6);
  }

  #updateAudio() {
    if (!this.player) return;
    const b = this.player.body;
    const spd = speed(b);
    const g = gearFor(spd, b.spec.topSpeed);
    this.audio.update({
      rpm: g.rpm,
      load: (this.player.input?.throttle ?? 0) * 0.8 + b.slip * 0.2,
      speed: spd,
      slip: b.slip,
      note: b.spec.engineNote,
      boosting: b.boosting
    });
  }

  #updateCamera(dt, snap) {
    if (!this.player) return;
    const b = this.player.body;
    const spd = speed(b);
    const f = forwardVector(b.yaw);
    const mode = CAMERAS[this.cameraMode];

    const target = new THREE.Vector3();
    const look = new THREE.Vector3();

    if (mode === 'hood') {
      // Just ahead of the windscreen, looking down the road.
      const ahead = b.spec.length * 0.52 + 0.6;
      target.set(
        b.pos.x + f.x * ahead,
        b.spec.height * 0.92,
        b.pos.z + f.z * ahead
      );
      look.set(b.pos.x + f.x * 40, b.spec.height * 0.72, b.pos.z + f.z * 40);
    } else if (mode === 'cinematic') {
      const dist = 12 + b.spec.length * 1.1;
      target.set(
        b.pos.x - f.x * dist * 0.55 - f.z * dist * 0.75,
        4.5 + b.spec.height * 0.5,
        b.pos.z - f.z * dist * 0.55 + f.x * dist * 0.75
      );
      look.set(b.pos.x, b.spec.height * 0.5, b.pos.z);
    } else {
      const dist = 6.2 + b.spec.length * 0.72 + spd * 0.075;
      const height = 2.1 + b.spec.height * 0.62 + spd * 0.02;
      target.set(b.pos.x - f.x * dist, height, b.pos.z - f.z * dist);
      look.set(b.pos.x + f.x * 9, b.spec.height * 0.55, b.pos.z + f.z * 9);
    }

    if (this.state === 'countdown') {
      // Slow orbit while the lights go out.
      const a = this.countdown * 0.9;
      const dist = 9 + b.spec.length * 0.8;
      target.set(b.pos.x + Math.sin(a) * dist, 3.4 + b.spec.height * 0.4, b.pos.z + Math.cos(a) * dist);
      look.set(b.pos.x, b.spec.height * 0.5, b.pos.z);
    }

    const lerp = snap ? 1 : 1 - Math.pow(0.0016, dt);
    this.camera.position.lerp(target, mode === 'hood' ? 1 : lerp);
    this.camLook.lerp(look, snap ? 1 : 1 - Math.pow(0.0004, dt));

    this.camShake = Math.max(0, this.camShake - dt * 1.6);
    if (this.camShake > 0.001) {
      const s = this.camShake * 0.5;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }

    this.camera.lookAt(this.camLook);
    // Roll the view slightly into the slide — cheap sense of speed.
    this.camera.rotation.z += b.lean * 0.25 + b.w * 0.004;
    this.camera.fov = 62 + Math.min(16, spd * 0.28) + (b.boosting ? 5 : 0);
    this.camera.updateProjectionMatrix();
  }

  #updateHud() {
    if (!this.player) return;
    const b = this.player.body;
    const spd = speed(b);
    const g = gearFor(spd, b.spec.topSpeed);

    const standings = this.#standings();
    const place = standings.findIndex((c) => c.isPlayer) + 1;
    const lapNum = Math.max(1, Math.min(this.totalLaps, this.player.lapsCompleted + 1));

    this.ui.setHud({
      speedKmh: spd * 3.6,
      rpm: g.rpm,
      boost: b.boost,
      gear: b.u < -0.5 ? 'R' : spd < 0.4 ? 'N' : String(g.gear),
      lapText: this.totalLaps === Infinity ? `${Math.max(0, this.player.lapsCompleted + 1)}` : `${lapNum} / ${this.totalLaps}`,
      posText: this.config.mode === 'race' ? `${place} / ${this.cars.length}` : '—',
      time: this.raceTime,
      lastLap: this.player.lastLap,
      bestLap: this.player.bestLap
    });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.previewCamera.aspect = w / h;
    this.previewCamera.updateProjectionMatrix();
  }
}

// ---------------------------------------------------------------------------

const SMOKE = new THREE.Color(0.72, 0.72, 0.76);
const BOOST_COLORS = {
  taxi: new THREE.Color(0.45, 0.8, 1.0),
  minibus: new THREE.Color(1.0, 0.62, 0.25),
  icecream: new THREE.Color(1.0, 0.78, 0.9),
  bus: new THREE.Color(0.24, 0.24, 0.26)   // it just makes more smoke
};

const RATIOS = [0.17, 0.32, 0.48, 0.66, 0.84, 1.0];

function gearFor(spd, topSpeed) {
  const frac = Math.min(0.999, Math.abs(spd) / topSpeed);
  let prev = 0;
  for (let i = 0; i < RATIOS.length; i++) {
    if (frac <= RATIOS[i]) {
      const span = RATIOS[i] - prev || 1;
      return { gear: i + 1, rpm: 0.18 + 0.82 * ((frac - prev) / span) };
    }
    prev = RATIOS[i];
  }
  return { gear: RATIOS.length, rpm: 1 };
}

export const SUN_DIR = new THREE.Vector3(-0.48, 0.46, 0.75).normalize();

function buildSky() {
  const geo = new THREE.SphereGeometry(1600, 40, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color(0x2f7fd8) },
      mid: { value: new THREE.Color(0x8fc4ee) },
      horizon: { value: new THREE.Color(0xd6e6f2) },
      sun: { value: new THREE.Color(0xfff6de) },
      sunDir: { value: SUN_DIR.clone() }
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sun;
      uniform vec3 sunDir;
      varying vec3 vPos;
      void main() {
        vec3 dir = normalize(vPos);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.28, h));
        c = mix(c, zenith, smoothstep(0.2, 0.85, h));

        // Sun disc plus the wide haze around it.
        float d = max(dot(dir, normalize(sunDir)), 0.0);
        c += sun * pow(d, 900.0) * 6.0;
        c += sun * pow(d, 16.0) * 0.35;
        c += sun * pow(d, 3.0) * 0.08;

        // Humid Hong Kong haze thickens right at the waterline.
        c = mix(c, horizon, smoothstep(0.1, -0.05, dir.y) * 0.5);
        gl_FragColor = vec4(c, 1.0);
      }`
  });

  const sky = new THREE.Group();
  sky.add(new THREE.Mesh(geo, mat));
  sky.add(buildClouds());
  return sky;
}

function buildClouds() {
  const clouds = new THREE.Group();
  clouds.name = 'clouds';

  const textures = [cloudTexture(3), cloudTexture(11), cloudTexture(29)];
  for (let i = 0; i < 34; i++) {
    const mat = new THREE.SpriteMaterial({
      map: textures[i % textures.length],
      transparent: true,
      depthWrite: false,
      opacity: 0.5 + Math.random() * 0.4,
      fog: false
    });
    const s = new THREE.Sprite(mat);

    const angle = (i / 34) * Math.PI * 2 + Math.random() * 0.3;
    const radius = 620 + Math.random() * 620;
    const size = 260 + Math.random() * 420;
    s.position.set(Math.cos(angle) * radius, 230 + Math.random() * 300, Math.sin(angle) * radius);
    s.scale.set(size, size * (0.4 + Math.random() * 0.2), 1);
    clouds.add(s);
  }
  return clouds;
}

let _cloudCache = new Map();
function cloudTexture(seed) {
  if (_cloudCache.has(seed)) return _cloudCache.get(seed);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');

  // Stack soft radial blobs along a flat base — reads as a cumulus at distance.
  let a = seed >>> 0;
  const rnd = () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
  for (let i = 0; i < 26; i++) {
    const x = 30 + rnd() * 196;
    const lift = Math.sin((x / 256) * Math.PI);
    const y = 96 - rnd() * 46 * lift;
    const r = (14 + rnd() * 30) * (0.5 + lift * 0.7);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.62)');
    grad.addColorStop(0.55, 'rgba(248,251,255,0.3)');
    grad.addColorStop(1, 'rgba(240,246,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  _cloudCache.set(seed, tex);
  return tex;
}


new Game();
