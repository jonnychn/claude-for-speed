// The Hong Kong roster. Every vehicle is modelled from primitives at run time,
// so the whole game stays as readable source with no binary assets.

import * as THREE from 'three';
import { signTexture } from './track.js';

const paint = (color, extra = {}) => new THREE.MeshStandardMaterial({
  color, roughness: 0.42, metalness: 0.18, ...extra
});
const glass = () => new THREE.MeshStandardMaterial({
  color: 0x0b1a29, roughness: 0.14, metalness: 0.5, transparent: true, opacity: 0.72
});
const rubber = () => new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.95 });
const chrome = () => new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.25, metalness: 0.9 });
const trim = () => new THREE.MeshStandardMaterial({ color: 0x1b1e25, roughness: 0.7 });

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function panel(w, h, tex, x, y, z, ry = 0) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })
  );
  m.position.set(x, y, z);
  m.rotation.y = ry;
  return m;
}

function wheel(radius, width) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18), rubber());
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  g.add(tyre);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.02, 12),
    new THREE.MeshStandardMaterial({ color: 0x8b939c, roughness: 0.35, metalness: 0.85 })
  );
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(width + 0.03, radius * 0.9, 0.06), chrome());
    spoke.rotation.x = (i / 5) * Math.PI;
    g.add(spoke);
  }
  return g;
}

/** Emissive lamp that can be dimmed/brightened at run time. */
function lamp(w, h, d, color, intensity = 1) {
  const mat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity, roughness: 0.3, toneMapped: false
  });
  const m = box(w, h, d, mat);
  m.userData.lampMaterial = mat;
  return m;
}

// ---------------------------------------------------------------------------
// 1. 舊款雙層巴士 — the old-school non-aircon double decker ("hot dog bus")
// ---------------------------------------------------------------------------
function buildDoubleDecker() {
  const g = new THREE.Group();
  const L = 11.2, W = 2.5;
  const red = paint(0xc2192b, { roughness: 0.55 });
  const cream = paint(0xe8dcc0, { roughness: 0.6 });
  const dark = trim();

  // Lower deck + upper deck as two stacked shells.
  g.add(box(W, 1.85, L, red, 0, 1.15, 0));
  g.add(box(W - 0.06, 1.75, L - 0.15, red, 0, 3.02, -0.05));
  // Cream waistband and roof — the classic livery split.
  g.add(box(W + 0.05, 0.42, L + 0.02, cream, 0, 2.12, 0));
  g.add(box(W - 0.12, 0.22, L - 0.3, cream, 0, 3.94, -0.05));
  // Skirt below the windows.
  g.add(box(W + 0.02, 0.5, L - 0.4, dark, 0, 0.42, 0));

  // Glazing: long strips both decks, plus the big upstairs front window.
  for (const s of [-1, 1]) {
    g.add(box(0.06, 0.8, L - 1.6, glass(), s * (W / 2 + 0.01), 1.74, -0.1));
    g.add(box(0.06, 0.9, L - 1.5, glass(), s * (W / 2 + 0.01), 3.32, -0.1));
  }
  g.add(box(W - 0.35, 1.15, 0.08, glass(), 0, 3.25, L / 2 - 0.06));   // upper windscreen
  g.add(box(W - 0.5, 0.95, 0.08, glass(), 0, 1.75, L / 2 - 0.04));    // lower windscreen
  g.add(box(W - 0.4, 1.0, 0.08, glass(), 0, 3.2, -L / 2 + 0.06));     // upstairs rear window

  // Destination blind — route 1A, Tsim Sha Tsui Ferry.
  const blindTex = signTexture('1A 尖沙咀碼頭', '#ffd66b', '#12100c');
  const blind = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.4, 0.55),
    new THREE.MeshBasicMaterial({ map: blindTex, toneMapped: false })
  );
  blind.position.set(0, 4.02, L / 2 - 0.02);
  g.add(blind);

  // Open rear staircase door and the driver's cab split.
  g.add(box(0.9, 1.7, 0.07, dark, W / 2 - 0.62, 1.05, -L / 2 + 0.05));
  g.add(box(0.07, 1.6, 1.0, dark, -W / 2 - 0.01, 1.05, L / 2 - 1.9));

  // Lights.
  const heads = [];
  for (const s of [-1, 1]) {
    const h = lamp(0.42, 0.3, 0.12, 0xfff2cc, 0.2);
    h.position.set(s * (W / 2 - 0.45), 0.85, L / 2 + 0.02);
    g.add(h); heads.push(h.userData.lampMaterial);
  }
  const brakes = [];
  for (const s of [-1, 1]) {
    const t = lamp(0.28, 0.5, 0.1, 0xff2b1f, 0.35);
    t.position.set(s * (W / 2 - 0.35), 1.1, -L / 2 - 0.02);
    g.add(t); brakes.push(t.userData.lampMaterial);
  }

  // Bumpers, mirrors, roof vents.
  g.add(box(W + 0.08, 0.28, 0.3, chrome(), 0, 0.45, L / 2 + 0.08));
  g.add(box(W + 0.08, 0.28, 0.3, chrome(), 0, 0.45, -L / 2 - 0.08));
  for (const s of [-1, 1]) g.add(box(0.1, 0.34, 0.16, dark, s * (W / 2 + 0.28), 2.5, L / 2 - 0.4));
  for (let i = -2; i <= 2; i++) g.add(box(0.7, 0.12, 0.5, cream, 0, 4.08, i * 1.8));

  const wheels = [];
  const wz = [L / 2 - 2.1, -L / 2 + 2.6];
  for (const s of [-1, 1]) {
    const front = wheel(0.52, 0.34);
    front.position.set(s * (W / 2 - 0.1), 0.52, wz[0]);
    g.add(front); wheels.push(front);
    // Twin rear wheels, like the real thing.
    for (const d of [0, 0.36]) {
      const rear = wheel(0.52, 0.32);
      rear.position.set(s * (W / 2 - 0.1 - d), 0.52, wz[1]);
      g.add(rear); wheels.push(rear);
    }
  }

  return { group: g, wheels, steerWheels: wheels.slice(0, 1).concat(wheels.slice(3, 4)), heads, brakes };
}

// ---------------------------------------------------------------------------
// 2. 綠色小巴 — the 16-seat green minibus
// ---------------------------------------------------------------------------
function buildGreenMinibus() {
  const g = new THREE.Group();
  const L = 6.5, W = 2.0;
  const white = paint(0xf1f3f0, { roughness: 0.5 });
  const green = paint(0x0f8a4a, { roughness: 0.45 });
  const dark = trim();

  g.add(box(W, 1.5, L, white, 0, 1.05, 0));
  g.add(box(W - 0.04, 0.72, L - 0.5, green, 0, 2.1, -0.1));   // green upper band + roof
  g.add(box(W - 0.14, 0.14, L - 0.9, green, 0, 2.45, -0.1));
  g.add(box(W + 0.02, 0.42, L - 0.3, dark, 0, 0.4, 0));

  // Sloped bonnet and a big flat windscreen.
  const nose = box(W - 0.08, 0.72, 0.9, white, 0, 1.28, L / 2 - 0.42);
  nose.rotation.x = -0.18;
  g.add(nose);
  const screen = box(W - 0.22, 1.05, 0.08, glass(), 0, 1.86, L / 2 - 0.62);
  screen.rotation.x = -0.16;
  g.add(screen);

  for (const s of [-1, 1]) {
    g.add(box(0.06, 0.86, L - 2.3, glass(), s * (W / 2 + 0.01), 1.72, -0.5));
    g.add(box(0.06, 0.7, 0.9, glass(), s * (W / 2 + 0.01), 1.7, L / 2 - 1.55));
  }
  g.add(box(W - 0.3, 0.85, 0.08, glass(), 0, 1.72, -L / 2 + 0.05));

  // The red LED destination sign, and the hand-written fare card beside it.
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.35, 0.34),
    new THREE.MeshBasicMaterial({ map: signTexture('旺角 → 西貢', '#ff3320', '#0a0a0a'), toneMapped: false })
  );
  sign.position.set(0, 2.28, L / 2 - 0.6);
  sign.rotation.x = -0.1;
  g.add(sign);

  const fare = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.5),
    new THREE.MeshBasicMaterial({ map: signTexture('$9.5', '#e8342a', '#f7f2e4'), toneMapped: false })
  );
  fare.position.set(-W / 2 - 0.02, 1.72, L / 2 - 1.55);
  fare.rotation.y = -Math.PI / 2;
  g.add(fare);

  // Sliding door track on the near side.
  g.add(box(0.05, 1.3, 1.2, dark, W / 2 + 0.02, 1.05, 0.4));

  const heads = [];
  for (const s of [-1, 1]) {
    const h = lamp(0.34, 0.22, 0.1, 0xfff4d6, 0.2);
    h.position.set(s * (W / 2 - 0.32), 0.85, L / 2 + 0.01);
    g.add(h); heads.push(h.userData.lampMaterial);
  }
  const brakes = [];
  for (const s of [-1, 1]) {
    const t = lamp(0.2, 0.42, 0.08, 0xff2b1f, 0.35);
    t.position.set(s * (W / 2 - 0.24), 1.15, -L / 2 - 0.02);
    g.add(t); brakes.push(t.userData.lampMaterial);
  }

  for (const s of [-1, 1]) g.add(box(0.08, 0.26, 0.14, dark, s * (W / 2 + 0.22), 1.95, L / 2 - 0.5));
  g.add(box(W + 0.04, 0.22, 0.24, chrome(), 0, 0.5, L / 2 + 0.06));

  const wheels = [];
  const wz = [L / 2 - 1.55, -L / 2 + 1.35];
  for (const s of [-1, 1]) {
    for (const z of wz) {
      const w = wheel(0.38, 0.26);
      w.position.set(s * (W / 2 - 0.06), 0.38, z);
      g.add(w); wheels.push(w);
    }
  }
  return { group: g, wheels, steerWheels: [wheels[0], wheels[2]], heads, brakes };
}

// ---------------------------------------------------------------------------
// 3. 紅的 — the urban red taxi
// ---------------------------------------------------------------------------
function buildRedTaxi() {
  const g = new THREE.Group();
  const L = 4.85, W = 1.76;
  const red = paint(0xd21f27, { roughness: 0.3, metalness: 0.35 });
  const silver = paint(0xc9ccd2, { roughness: 0.35, metalness: 0.5 });
  const dark = trim();

  g.add(box(W, 0.72, L, red, 0, 0.66, 0));
  g.add(box(W - 0.14, 0.28, L - 0.5, red, 0, 1.12, -0.05));      // shoulder line
  // Greenhouse: silver roof over a red waist — the Crown Comfort look.
  const cabin = box(W - 0.2, 0.6, 2.45, red, 0, 1.42, -0.28);
  g.add(cabin);
  g.add(box(W - 0.28, 0.1, 2.3, silver, 0, 1.74, -0.3));
  g.add(box(W + 0.02, 0.2, L - 0.7, dark, 0, 0.34, 0));

  // Glass all round.
  const front = box(W - 0.3, 0.62, 0.08, glass(), 0, 1.42, 0.98);
  front.rotation.x = -0.42; g.add(front);
  const rear = box(W - 0.32, 0.58, 0.08, glass(), 0, 1.42, -1.52);
  rear.rotation.x = 0.4; g.add(rear);
  for (const s of [-1, 1]) {
    g.add(box(0.05, 0.46, 1.05, glass(), s * (W / 2 - 0.1), 1.44, 0.2));
    g.add(box(0.05, 0.44, 0.85, glass(), s * (W / 2 - 0.1), 1.44, -0.95));
  }

  // Roof sign + the "for hire" flag on the dash.
  const roofSign = box(0.86, 0.24, 0.36, new THREE.MeshStandardMaterial({
    color: 0xf5f2e8, emissive: 0xffdca8, emissiveIntensity: 0.25, roughness: 0.4
  }), 0, 1.92, -0.2);
  g.add(roofSign);
  g.add(panel(0.8, 0.2, signTexture('TAXI 的士', '#2a2118', '#f7e7bd'), 0, 1.92, 0.0, 0));
  const forHire = lamp(0.3, 0.12, 0.06, 0xff3b30, 0.9);
  forHire.position.set(-0.36, 1.16, 0.92);
  g.add(forHire);

  // Door decals: the fare table every red taxi carries.
  for (const s of [-1, 1]) {
    g.add(panel(1.0, 0.3, signTexture('香港的士  HK TAXI', '#f2eee4', '#00000000'),
      s * (W / 2 + 0.012), 0.78, 0.1, s * Math.PI / 2));
  }

  const heads = [];
  for (const s of [-1, 1]) {
    const h = lamp(0.34, 0.16, 0.1, 0xfff6e0, 0.2);
    h.position.set(s * (W / 2 - 0.3), 0.78, L / 2 + 0.01);
    g.add(h); heads.push(h.userData.lampMaterial);
  }
  const brakes = [];
  for (const s of [-1, 1]) {
    const t = lamp(0.32, 0.16, 0.08, 0xff2b1f, 0.35);
    t.position.set(s * (W / 2 - 0.28), 0.88, -L / 2 - 0.01);
    g.add(t); brakes.push(t.userData.lampMaterial);
  }

  g.add(box(W - 0.34, 0.2, 0.1, dark, 0, 0.7, L / 2 + 0.02));
  g.add(box(W + 0.02, 0.16, 0.22, chrome(), 0, 0.5, L / 2 + 0.04));
  g.add(box(W + 0.02, 0.16, 0.22, chrome(), 0, 0.5, -L / 2 - 0.04));
  for (const s of [-1, 1]) g.add(box(0.14, 0.12, 0.08, dark, s * (W / 2 + 0.08), 1.28, 0.72));

  const wheels = [];
  const wz = [L / 2 - 1.1, -L / 2 + 0.95];
  for (const s of [-1, 1]) {
    for (const z of wz) {
      const w = wheel(0.32, 0.22);
      w.position.set(s * (W / 2 - 0.04), 0.32, z);
      g.add(w); wheels.push(w);
    }
  }
  return { group: g, wheels, steerWheels: [wheels[0], wheels[2]], heads, brakes };
}

// ---------------------------------------------------------------------------
// 4. 富豪雪糕車 — the ice cream van, soft-serve swirl and all
// ---------------------------------------------------------------------------
function buildIceCreamVan() {
  const g = new THREE.Group();
  const L = 6.2, W = 2.05;
  const blue = paint(0x2f8fd8, { roughness: 0.4 });
  const white = paint(0xf6f8fa, { roughness: 0.45 });
  const dark = trim();

  g.add(box(W, 1.05, L - 1.2, white, 0, 0.95, -0.5));           // box body, lower half
  g.add(box(W - 0.02, 1.1, L - 1.2, blue, 0, 2.02, -0.5));      // upper half
  g.add(box(W - 0.1, 0.16, L - 1.4, white, 0, 2.62, -0.5));     // roof cap
  g.add(box(W - 0.12, 1.5, 1.5, white, 0, 1.35, L / 2 - 0.75)); // cab
  g.add(box(W + 0.02, 0.4, L - 0.6, dark, 0, 0.35, 0));

  const screen = box(W - 0.24, 0.86, 0.08, glass(), 0, 1.72, L / 2 - 0.06);
  screen.rotation.x = -0.12; g.add(screen);
  for (const s of [-1, 1]) g.add(box(0.05, 0.6, 1.0, glass(), s * (W / 2 - 0.06), 1.66, L / 2 - 0.8));

  // Serving hatch on the kerb side, with the menu board above it.
  g.add(box(0.06, 0.95, 2.0, new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 0.5 }),
    W / 2 + 0.02, 1.6, -0.5));
  g.add(panel(2.0, 0.5, signTexture('富豪雪糕 SOFT SERVE', '#ffffff', '#1f6fb2'),
    W / 2 + 0.06, 2.35, -0.5, Math.PI / 2));
  g.add(panel(2.4, 0.6, signTexture('$12 甜筒 · 珍寶橙冰', '#ffe9a8', '#00000000'),
    -W / 2 - 0.06, 1.85, -0.5, -Math.PI / 2));

  // The giant soft-serve on the roof.
  const swirl = new THREE.Group();
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 1.0, 16),
    new THREE.MeshStandardMaterial({ color: 0xd8a862, roughness: 0.8 })
  );
  cone.rotation.x = Math.PI;
  cone.position.y = 0.5;
  swirl.add(cone);
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xfdf6e6, roughness: 0.5 });
  let r = 0.44, y = 1.0;
  for (let i = 0; i < 5; i++) {
    const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), creamMat);
    blob.position.set(0, y, 0);
    blob.rotation.y = i * 0.6;
    swirl.add(blob);
    y += r * 0.72; r *= 0.76;
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 10), creamMat);
  tip.position.y = y + 0.05;
  swirl.add(tip);
  swirl.position.set(0, 2.7, -0.6);
  swirl.scale.setScalar(0.95);
  g.add(swirl);

  // The chime horn that plays that one song, forever.
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 10), chrome());
  horn.rotation.x = -Math.PI / 2;
  horn.position.set(-0.5, 2.72, L / 2 - 1.2);
  g.add(horn);

  const heads = [];
  for (const s of [-1, 1]) {
    const h = lamp(0.32, 0.2, 0.1, 0xfff2d0, 0.2);
    h.position.set(s * (W / 2 - 0.3), 0.85, L / 2 + 0.02);
    g.add(h); heads.push(h.userData.lampMaterial);
  }
  const brakes = [];
  for (const s of [-1, 1]) {
    const t = lamp(0.2, 0.38, 0.08, 0xff2b1f, 0.35);
    t.position.set(s * (W / 2 - 0.24), 1.05, -L / 2 - 0.02);
    g.add(t); brakes.push(t.userData.lampMaterial);
  }
  g.add(box(W + 0.02, 0.2, 0.24, chrome(), 0, 0.5, L / 2 + 0.06));

  const wheels = [];
  const wz = [L / 2 - 1.3, -L / 2 + 1.5];
  for (const s of [-1, 1]) {
    for (const z of wz) {
      const w = wheel(0.37, 0.26);
      w.position.set(s * (W / 2 - 0.06), 0.37, z);
      g.add(w); wheels.push(w);
    }
  }
  return { group: g, wheels, steerWheels: [wheels[0], wheels[2]], heads, brakes, swirl };
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export const VEHICLES = [
  {
    id: 'taxi',
    zh: '紅的',
    en: 'Red Taxi',
    tagline: 'Urban red Crown Comfort. Knows every rat run from Central to Causeway Bay.',
    tint: '#ff3b46',
    build: buildRedTaxi,
    stats: { speed: 0.92, accel: 0.86, grip: 0.95, brawl: 0.3 },
    spec: {
      mass: 1600, height: 1.5, length: 4.85, width: 1.76, wheelbase: 2.85, wheelRadius: 0.32,
      cgBias: 0.46, cgHeight: 0.52, maxSteer: 0.62, steerFalloff: 0.0016,
      grip: 1.36, corneringFront: 8.4, corneringRear: 11.5,
      engineForce: 11200, brakeForce: 17000, topSpeed: 58,
      rollFactor: 0.05, yawDamping: 1.7,
      boostPower: 1.28, boostDuration: 4.5, boostRecharge: 10,
      engineNote: 1.0
    }
  },
  {
    id: 'minibus',
    zh: '綠色小巴',
    en: 'Green Minibus',
    tagline: '16 seats, no seatbelts, one speed. The driver has somewhere to be.',
    tint: '#2fe38b',
    build: buildGreenMinibus,
    stats: { speed: 0.82, accel: 0.78, grip: 0.7, brawl: 0.5 },
    spec: {
      mass: 2400, height: 2.6, length: 6.5, width: 2.0, wheelbase: 3.4, wheelRadius: 0.38,
      cgBias: 0.45, cgHeight: 0.92, maxSteer: 0.55, steerFalloff: 0.0019,
      grip: 1.2, corneringFront: 7.4, corneringRear: 10.2,
      engineForce: 15800, brakeForce: 20500, topSpeed: 54,
      rollFactor: 0.09, yawDamping: 1.5,
      boostPower: 1.32, boostDuration: 5.2, boostRecharge: 8,
      engineNote: 0.72
    }
  },
  {
    id: 'icecream',
    zh: '雪糕車',
    en: 'Ice Cream Van',
    tagline: 'Parked outside the Star Ferry since 1970. Boost plays the jingle.',
    tint: '#57bdf2',
    build: buildIceCreamVan,
    stats: { speed: 0.66, accel: 0.66, grip: 0.62, brawl: 0.62 },
    spec: {
      mass: 2900, height: 2.9, length: 6.2, width: 2.05, wheelbase: 3.3, wheelRadius: 0.37,
      cgBias: 0.44, cgHeight: 1.02, maxSteer: 0.52, steerFalloff: 0.0021,
      grip: 1.14, corneringFront: 7.0, corneringRear: 9.6,
      engineForce: 16600, brakeForce: 19000, topSpeed: 48,
      rollFactor: 0.11, yawDamping: 1.4,
      boostPower: 1.38, boostDuration: 5.5, boostRecharge: 7.5,
      engineNote: 0.66
    }
  },
  {
    id: 'bus',
    zh: '舊款雙層巴士',
    en: 'Double Decker',
    tagline: 'Non-aircon, windows down, upstairs front seat. Physics gives way.',
    tint: '#ff9147',
    build: buildDoubleDecker,
    stats: { speed: 0.58, accel: 0.55, grip: 0.5, brawl: 1.0 },
    spec: {
      mass: 11000, height: 4.4, length: 11.2, width: 2.5, wheelbase: 5.6, wheelRadius: 0.52,
      cgBias: 0.47, cgHeight: 1.7, maxSteer: 0.46, steerFalloff: 0.0024,
      grip: 1.02, corneringFront: 6.0, corneringRear: 8.6,
      engineForce: 62000, brakeForce: 72000, topSpeed: 44,
      rollFactor: 0.17, yawDamping: 1.25,
      boostPower: 1.24, boostDuration: 6.0, boostRecharge: 9,
      engineNote: 0.5
    }
  }
];

/** Fill in the derived spec fields the physics needs but nobody wants to hand-tune. */
for (const v of VEHICLES) {
  const s = v.spec;
  s.drag = s.engineForce / (s.topSpeed * s.topSpeed * 2.1);
  s.rollingResistance = s.mass * 0.022;
  s.reverseTopSpeed = Math.max(5, s.topSpeed * 0.15);   // a manoeuvring crawl
}

export function getVehicle(id) {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}

/**
 * Build a display/driveable model. `livery` tints the AI copies so a field of
 * four minibuses doesn't look like a rendering bug.
 */
export function buildModel(def, livery) {
  const built = def.build();
  const g = new THREE.Group();
  g.add(built.group);
  g.userData = built;

  if (livery !== undefined && livery !== null) {
    built.group.traverse((o) => {
      if (o.isMesh && o.material?.color && !o.material.emissive?.getHex()) {
        // Nudge the hue of the big painted panels only.
        if (o.material.roughness > 0.25 && o.material.metalness < 0.6) {
          const c = o.material.color.clone().offsetHSL(livery * 0.11, 0, 0);
          o.material = o.material.clone();
          o.material.color.copy(c);
        }
      }
    });
  }
  return g;
}
