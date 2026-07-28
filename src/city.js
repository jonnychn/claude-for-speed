// Everything around the circuit: the harbour on the inside, the wall of neon
// tenements on the outside, and the boats that make it read as Hong Kong.

import * as THREE from 'three';
import { signTexture } from './track.js';

const SHOP_SIGNS = [
  '大排檔', '藥房', '麻雀', '茶餐廳', '找換店', '珠寶金行', '涼茶', '當舖',
  '海鮮酒家', '髮廊', '雲吞麵', '士多', '書局', '按摩', '燒臘', '冰室',
  '卡拉OK', '洗衣', '五金', '果欄'
];

const NEON_COLORS = ['#ff2d78', '#21e6ff', '#ffc542', '#2fe38b', '#ff6a3d', '#c77dff'];

export class City {
  constructor(track) {
    this.track = track;
    this.group = new THREE.Group();
    this.group.name = 'city';
    this.time = 0;
    this.movers = [];

    // Which way is "away from the harbour"? Constant for the whole loop.
    const p0 = track.at(0), n0 = track.normalAt(0);
    this.outward = Math.sign(p0.x * n0.x + p0.z * n0.z) || 1;

    this.group.add(this.#ground());
    this.group.add(this.#harbour());
    this.group.add(this.#promenade());
    this.group.add(this.#skyline());
    this.group.add(this.#neon());
    this.group.add(this.#streetFurniture());
    this.group.add(this.#boats());
  }

  // -- ground ---------------------------------------------------------------
  #ground() {
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: 0x55514a, roughness: 1 })
    );
    g.rotation.x = -Math.PI / 2;
    // Well below the harbour surface — this is only a backdrop for the land
    // beyond the city, and at -0.12 it covered the water entirely.
    g.position.y = -1.4;
    g.receiveShadow = true;
    return g;
  }

  // -- harbour --------------------------------------------------------------
  #harbour() {
    // Fill the inside of the loop, inset from the road so the two never z-fight.
    // Shapes live in XY. Building it as (x, -z) and rotating -90° about X lands
    // it at (x, 0, z) with the surface normal pointing up.
    const shape = new THREE.Shape();
    const inset = -this.outward * (this.track.halfWidth + 9);
    const step = 8;
    for (let i = 0; i < this.track.count; i += step) {
      const p = this.track.offsetPoint(i, inset);
      if (i === 0) shape.moveTo(p.x, -p.z); else shape.lineTo(p.x, -p.z);
    }
    shape.closePath();

    this.waterTex = reflectionTexture();
    const water = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshStandardMaterial({
        // Low roughness plus the sky environment map does the heavy lifting;
        // the map only adds the choppy glitter on top.
        color: 0x1a6285, roughness: 0.26, metalness: 0.28,
        map: this.waterTex, envMapIntensity: 0.55
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.35;
    return water;
  }

  #promenade() {
    const g = new THREE.Group();
    const inner = -this.outward * (this.track.halfWidth + 1.4);
    const outer = -this.outward * (this.track.halfWidth + 9);

    // Concrete waterfront deck.
    const pos = [], idx = [];
    const n = this.track.count;
    for (let i = 0; i < n; i++) {
      const a = this.track.offsetPoint(i, inner);
      const b = this.track.offsetPoint(i, outer);
      pos.push(a.x, 0.05, a.z, b.x, -0.02, b.z);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = a + 1, c = ((i + 1) % n) * 2, d = c + 1;
      idx.push(a, c, b, b, c, d, a, b, c, b, d, c); // double-sided, cheap
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7d7769, roughness: 0.95 })));

    // Railing along the water's edge.
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x8e959c, roughness: 0.45, metalness: 0.5 });
    for (let i = 0; i < n; i += 12) {
      const p = this.track.offsetPoint(i, outer * 0.96);
      const post = new THREE.Mesh(postGeo, railMat);
      post.position.set(p.x, 0.5, p.z);
      g.add(post);
    }
    return g;
  }

  // -- the wall of buildings ------------------------------------------------
  #skyline() {
    const g = new THREE.Group();
    const windows = windowTexture();
    const n = this.track.count;
    const rand = mulberry32(20240701);

    const concrete = [0x8f897b, 0xa39d90, 0x77828b, 0x9c8f7d, 0x828b84, 0xb0a996];

    // Three depth bands: shophouses at the kerb, tenements behind, towers beyond.
    // `gap` leaves the odd side street so it doesn't read as one endless wall.
    // `off` is the gap from the barrier to the *facade*, not to the centre of
    // the block — otherwise deep buildings swallow the road.
    const bands = [
      { off: 4, spread: 7, minH: 12, maxH: 30, every: 15, jitter: 4, gap: 0.16, tile: 6 },
      { off: 34, spread: 24, minH: 28, maxH: 76, every: 24, jitter: 12, gap: 0.1, tile: 7 },
      { off: 110, spread: 90, minH: 70, maxH: 190, every: 46, jitter: 40, gap: 0.06, tile: 9 }
    ];

    for (const band of bands) {
      for (let i = 0; i < n; i += band.every) {
        if (rand() < band.gap) continue;

        const h = band.minH + rand() * (band.maxH - band.minH);
        const w = 10 + rand() * 16;
        const d = 12 + rand() * 20;

        const offset = this.outward * (this.track.halfWidth + band.off + rand() * band.spread + d / 2);
        const base = this.track.offsetPoint(i, offset);
        const t = this.track.tangentAt(i);
        const yaw = Math.atan2(t.x, t.z);

        const mat = new THREE.MeshStandardMaterial({
          color: concrete[(rand() * concrete.length) | 0],
          roughness: 0.92, metalness: 0.03,
          // Windows read as dark glass by day rather than lit flats.
          emissiveMap: windows, emissive: 0xffffff, emissiveIntensity: 0.05 + rand() * 0.05
        });
        const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        // Jitter along the road only — sideways jitter would push facades
        // into the racing surface.
        const along = (rand() - 0.5) * band.jitter;
        tower.position.set(base.x + t.x * along, h / 2, base.z + t.z * along);
        tower.rotation.y = yaw + (rand() - 0.5) * 0.5;
        tower.castShadow = false;
        tower.receiveShadow = true;

        // Repeat the window texture so the lit grid scales with the building.
        tower.material.emissiveMap = windows.clone();
        tower.material.emissiveMap.needsUpdate = true;
        tower.material.emissiveMap.wrapS = tower.material.emissiveMap.wrapT = THREE.RepeatWrapping;
        tower.material.emissiveMap.repeat.set(Math.max(1, w / band.tile), Math.max(1, h / band.tile));
        g.add(tower);

        // Rooftop clutter: water tanks, aerials, the odd rooftop hut.
        if (rand() > 0.45) {
          const tank = new THREE.Mesh(
            new THREE.CylinderGeometry(1.4, 1.4, 2.2, 10),
            new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: 0.85 })
          );
          tank.position.set(tower.position.x + (rand() - 0.5) * w * 0.5, h + 1.1,
            tower.position.z + (rand() - 0.5) * d * 0.5);
          g.add(tank);
        }
        if (band === bands[2] && rand() > 0.6) {
          const mast = new THREE.Mesh(
            new THREE.CylinderGeometry(0.2, 0.3, 18, 6),
            new THREE.MeshStandardMaterial({ color: 0x6d727a, roughness: 0.7 })
          );
          mast.position.set(tower.position.x, h + 9, tower.position.z);
          g.add(mast);
          const beacon = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xd42d22 })
          );
          beacon.position.set(tower.position.x, h + 18, tower.position.z);
          g.add(beacon);
          this.movers.push({ type: 'beacon', mesh: beacon, phase: rand() * 6.28 });
        }
        // Bamboo scaffolding — there is always one building under renovation.
        if (band === bands[0] && rand() > 0.78) g.add(bambooScaffold(tower, w, h, d));
      }
    }
    return g;
  }

  // -- neon -----------------------------------------------------------------
  #neon() {
    const g = new THREE.Group();
    const rand = mulberry32(7719);
    const n = this.track.count;

    for (let i = 6; i < n; i += 20) {
      const color = NEON_COLORS[(rand() * NEON_COLORS.length) | 0];
      const text = SHOP_SIGNS[(rand() * SHOP_SIGNS.length) | 0];
      const vertical = rand() > 0.45;
      const height = 5 + rand() * 11;

      // Signs cantilever out over the road, the way they used to on Nathan Road.
      const armLength = 3.5 + rand() * 5;
      const rootOffset = this.outward * (this.track.halfWidth + 2.2);
      const root = this.track.offsetPoint(i, rootOffset);
      const t = this.track.tangentAt(i);
      const yaw = Math.atan2(t.x, t.z);

      const sign = new THREE.Group();
      sign.position.set(root.x, height, root.z);
      sign.rotation.y = yaw;

      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.14, armLength),
        new THREE.MeshStandardMaterial({ color: 0x1c1f27, roughness: 0.7 })
      );
      arm.rotation.y = Math.PI / 2;
      arm.position.x = -this.outward * armLength / 2;
      sign.add(arm);

      const w = vertical ? 1.5 : 4.2 + rand() * 2;
      const h = vertical ? 4.5 + rand() * 3 : 1.4;
      const boardMat = new THREE.MeshStandardMaterial({ color: 0x2b303a, roughness: 0.6 });
      const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.28), boardMat);
      board.position.set(-this.outward * armLength, -h / 2 + 0.2, 0);
      sign.add(board);

      // Painted signboard: white characters on a colour-filled panel, which is
      // what these actually look like with the sun on them.
      const tex = signTexture(text, '#ffffff', color, vertical);
      for (const s of [1, -1]) {
        const face = new THREE.Mesh(
          new THREE.PlaneGeometry(w * 0.92, h * 0.92),
          new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
        );
        face.position.set(board.position.x, board.position.y, s * 0.16);
        if (s < 0) face.rotation.y = Math.PI;
        sign.add(face);
      }

      // Tube outline around the board so it glows even from behind.
      // Daylight: this is the painted tube housing, not a glow.
      const glow = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.18, h + 0.18, 0.1),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
      );
      glow.position.copy(board.position);
      sign.add(glow);

      g.add(sign);
    }
    return g;
  }

  // -- street level ---------------------------------------------------------
  #streetFurniture() {
    const g = new THREE.Group();
    const rand = mulberry32(99123);
    const n = this.track.count;

    // Street lamps, both sides.
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 8, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x6f7681, roughness: 0.65, metalness: 0.4 });
    const headGeo = new THREE.BoxGeometry(1.4, 0.22, 0.5);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.5, metalness: 0.4 });

    for (let i = 0; i < n; i += 34) {
      for (const side of [1, -1]) {
        const off = side * this.outward * (this.track.halfWidth + 2.6);
        const p = this.track.offsetPoint(i, off);
        const t = this.track.tangentAt(i);
        const lamp = new THREE.Group();
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 4;
        lamp.add(pole);
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.set(-Math.sign(off) * 0.8, 7.9, 0);
        lamp.add(head);
        lamp.position.set(p.x, 0, p.z);
        lamp.rotation.y = Math.atan2(t.x, t.z);
        g.add(lamp);
      }
    }

    // Parked ding-ding tram on the outside shoulder — pure scenery.
    for (let k = 0; k < 3; k++) {
      const i = (200 + k * 470) % n;
      const p = this.track.offsetPoint(i, this.outward * (this.track.halfWidth + 7));
      const t = this.track.tangentAt(i);
      const tram = buildTram();
      tram.position.set(p.x, 0, p.z);
      tram.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2;
      g.add(tram);
    }

    // Traffic cones and roadworks barriers on the shoulders.
    const coneGeo = new THREE.ConeGeometry(0.24, 0.7, 8);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.6 });
    for (let i = 0; i < n; i += 9) {
      if (rand() > 0.32) continue;
      const side = rand() > 0.5 ? 1 : -1;
      const p = this.track.offsetPoint(i, side * (this.track.halfWidth - 0.4 - rand() * 0.6));
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(p.x, 0.35, p.z);
      g.add(cone);
    }

    return g;
  }

  // -- the harbour traffic --------------------------------------------------
  #boats() {
    const g = new THREE.Group();

    const junk = buildJunk();
    junk.position.set(-40, 0, 20);
    g.add(junk);
    this.movers.push({ type: 'boat', mesh: junk, radius: 95, speed: 0.035, phase: 0, bob: 0.5 });

    const ferry = buildStarFerry();
    ferry.position.set(60, 0, -40);
    g.add(ferry);
    this.movers.push({ type: 'boat', mesh: ferry, radius: 130, speed: -0.022, phase: 2.1, bob: 0.3 });

    const sampan = buildJunk(0.45);
    g.add(sampan);
    this.movers.push({ type: 'boat', mesh: sampan, radius: 62, speed: 0.05, phase: 4.2, bob: 0.7 });

    return g;
  }

  update(dt) {
    this.time += dt;

    if (this.waterTex) {
      this.waterTex.offset.y = (this.time * 0.02) % 1;
      this.waterTex.offset.x = Math.sin(this.time * 0.15) * 0.02;
    }

    for (const m of this.movers) {
      if (m.type === 'boat') {
        const a = m.phase + this.time * m.speed;
        m.mesh.position.set(Math.cos(a) * m.radius, -0.2 + Math.sin(this.time * 1.1 + m.phase) * m.bob * 0.4,
          Math.sin(a) * m.radius);
        m.mesh.rotation.y = -a + Math.PI / 2;
        m.mesh.rotation.z = Math.sin(this.time * 0.9 + m.phase) * 0.03;
      } else if (m.type === 'beacon') {
        m.mesh.visible = Math.sin(this.time * 2 + m.phase) > 0;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

function bambooScaffold(tower, w, h, d) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.85 });
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, h, 5);
  const railGeo = new THREE.CylinderGeometry(0.06, 0.06, w + 0.4, 5);
  const cols = Math.max(3, Math.round(w / 2.2));
  for (let i = 0; i <= cols; i++) {
    const p = new THREE.Mesh(poleGeo, mat);
    p.position.set(-w / 2 + (i * w) / cols, h / 2, d / 2 + 0.35);
    g.add(p);
  }
  for (let y = 2; y < h; y += 2.4) {
    const r = new THREE.Mesh(railGeo, mat);
    r.rotation.z = Math.PI / 2;
    r.position.set(0, y, d / 2 + 0.35);
    g.add(r);
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h * 0.6),
    new THREE.MeshStandardMaterial({ color: 0x2f6d4f, roughness: 1, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  mesh.position.set(0, h * 0.4, d / 2 + 0.45);
  g.add(mesh);

  g.position.copy(tower.position);
  g.position.y = 0;
  g.rotation.y = tower.rotation.y;
  return g;
}

function buildTram() {
  const g = new THREE.Group();
  const green = new THREE.MeshStandardMaterial({ color: 0x1f6f3f, roughness: 0.55 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xe6dcc2, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.7 });

  const lower = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.9, 8.6), green);
  lower.position.y = 1.2; g.add(lower);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.7, 8.2), green);
  upper.position.y = 3.0; g.add(upper);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.16, 8.4), cream);
  roof.position.y = 3.92; g.add(roof);
  // The full-length advert panel every tram wears.
  const ad = new THREE.Mesh(
    new THREE.PlaneGeometry(7.6, 1.5),
    new THREE.MeshBasicMaterial({ map: signTexture('叮叮 · 電車', '#ffe08a', '#1a4d33'), toneMapped: false, side: THREE.DoubleSide })
  );
  ad.position.set(1.12, 3.0, 0);
  ad.rotation.y = Math.PI / 2;
  g.add(ad);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 5), dark);
  pole.position.set(0, 5.2, -1.5);
  pole.rotation.x = 0.5;
  g.add(pole);
  for (const z of [3.2, -3.2]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.22, 12), dark);
    w.rotation.z = Math.PI / 2;
    w.position.set(0, 0.4, z);
    g.add(w);
  }
  return g;
}

function buildJunk(scale = 1) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(5, 2.2, 18),
    new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.85 })
  );
  hull.position.y = 1;
  g.add(hull);
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 1.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x5a4128, roughness: 0.8 })
  );
  deck.position.set(0, 2.8, -3);
  g.add(deck);

  const sailMat = new THREE.MeshStandardMaterial({
    color: 0xb8321f, roughness: 0.9, side: THREE.DoubleSide
  });
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x2b2016, roughness: 0.9 });
  const sails = [[7, 9, 4], [9, 12, -2], [6, 8, -8]];
  for (const [w, h, z] of sails) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, h + 3, 6), mastMat);
    mast.position.set(0, (h + 3) / 2 + 2, z);
    g.add(mast);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(w, h), sailMat);
    sail.position.set(0, h / 2 + 3.4, z);
    sail.rotation.y = Math.PI / 2;
    g.add(sail);
  }
  g.scale.setScalar(scale);
  return g;
}

function buildStarFerry() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(9, 3.2, 34),
    new THREE.MeshStandardMaterial({ color: 0x14202c, roughness: 0.7 })
  );
  hull.position.y = 1.4; g.add(hull);
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(8.4, 2.6, 26),
    new THREE.MeshStandardMaterial({
      color: 0x0f5b46, roughness: 0.55
    })
  );
  deck.position.y = 4.2; g.add(deck);
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(8.6, 0.3, 26),
    new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.7 })
  );
  top.position.y = 5.7; g.add(top);
  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.1, 4, 10),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.7 })
  );
  funnel.position.set(0, 7.6, 0); g.add(funnel);
  // Lit windows down both flanks.
  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.2, metalness: 0.5 })
    );
    win.position.set(s * 4.25, 4.4, 0);
    win.rotation.y = s * Math.PI / 2;
    g.add(win);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

let _windows;
function windowTexture() {
  if (_windows) return _windows;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  const warm = ['#ffd9a0', '#ffe9c4', '#cfe4ff', '#a8d8ff', '#fff2d0', '#7fd6c0'];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (Math.random() < 0.42) continue;   // dark flats
      g.fillStyle = warm[(Math.random() * warm.length) | 0];
      g.globalAlpha = 0.45 + Math.random() * 0.55;
      g.fillRect(x * 16 + 3, y * 16 + 4, 10, 8);
    }
  }
  _windows = new THREE.CanvasTexture(c);
  _windows.wrapS = _windows.wrapT = THREE.RepeatWrapping;
  return _windows;
}

let _reflection;
function reflectionTexture() {
  if (_reflection) return _reflection;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#22698c';
  g.fillRect(0, 0, 256, 256);

  // Choppy little wavelets catching the sun.
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const w = 2 + Math.random() * 9;
    g.globalAlpha = 0.05 + Math.random() * 0.22;
    g.fillStyle = Math.random() > 0.4 ? '#dff2ff' : '#155f80';
    g.fillRect(x, y, w, 1.4);
  }
  _reflection = new THREE.CanvasTexture(c);
  _reflection.wrapS = _reflection.wrapT = THREE.RepeatWrapping;
  // ShapeGeometry UVs are raw world coordinates, so the repeat is per-metre.
  _reflection.repeat.set(0.06, 0.06);
  return _reflection;
}

/** Small deterministic PRNG so the city looks the same every session. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
