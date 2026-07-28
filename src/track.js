// The Victoria Harbour circuit: a closed loop around the waterfront.
// Everything else in the game — AI lines, lap timing, the minimap, where the
// buildings go — is derived from this one spline.

import * as THREE from 'three';

// Hand-placed centreline, roughly a lap of the harbourfront: a long promenade
// straight, a fast eastern sweeper, a tight chicane behind the godowns, and a
// hairpin-ish left back onto the straight.
const CENTERLINE = [
  [-230, 192], [-120, 202], [0, 206], [120, 199], [214, 184],
  [256, 130], [268, 58], [248, 8], [276, -42], [262, -112],
  [214, -162], [138, -196], [58, -176], [18, -206], [-52, -216],
  [-142, -200], [-216, -168], [-262, -102], [-248, -20], [-270, 60],
  [-256, 132]
];

const SAMPLES = 1600;

export class Track {
  constructor() {
    this.halfWidth = 12;
    this.curve = new THREE.CatmullRomCurve3(
      CENTERLINE.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'catmullrom', 0.5
    );

    const pts = this.curve.getSpacedPoints(SAMPLES);
    this.points = pts.slice(0, SAMPLES);
    this.count = SAMPLES;

    this.tangents = [];
    this.normals = [];
    this.arc = new Float32Array(SAMPLES);
    this.curvature = new Float32Array(SAMPLES);

    let total = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const prev = this.points[(i - 1 + SAMPLES) % SAMPLES];
      const next = this.points[(i + 1) % SAMPLES];
      const t = new THREE.Vector3().subVectors(next, prev).normalize();
      this.tangents.push(t);
      this.normals.push(new THREE.Vector3(t.z, 0, -t.x));
      this.arc[i] = total;
      total += this.points[i].distanceTo(next);
    }
    this.length = total;

    // Signed curvature per sample — the AI uses it to know when to lift.
    for (let i = 0; i < SAMPLES; i++) {
      const a = this.tangents[(i - 4 + SAMPLES) % SAMPLES];
      const b = this.tangents[(i + 4) % SAMPLES];
      const cross = a.x * b.z - a.z * b.x;
      const seg = this.points[i].distanceTo(this.points[(i + 8) % SAMPLES]) || 1;
      this.curvature[i] = Math.asin(THREE.MathUtils.clamp(cross, -1, 1)) / seg;
    }

    this.startIndex = 40;
  }

  at(i) { return this.points[((i % this.count) + this.count) % this.count]; }
  tangentAt(i) { return this.tangents[((i % this.count) + this.count) % this.count]; }
  normalAt(i) { return this.normals[((i % this.count) + this.count) % this.count]; }
  curvatureAt(i) { return this.curvature[((i % this.count) + this.count) % this.count]; }

  /** Worst curvature in the next `ahead` metres — the "how hard is the next corner" probe. */
  worstCurvature(index, ahead) {
    const step = Math.max(1, Math.floor(this.count / this.length)); // ~1 sample per metre
    let worst = 0;
    for (let d = 0; d < ahead; d += 4) {
      const k = Math.abs(this.curvatureAt(index + d * step));
      if (k > worst) worst = k;
    }
    return worst;
  }

  /**
   * Closest point on the centreline. `hint` is the caller's last index, which
   * turns this into a ±window search instead of scanning 1600 samples a frame.
   */
  nearest(pos, hint) {
    let best = -1, bestSq = Infinity;
    if (hint !== undefined && hint !== null) {
      for (let d = -70; d <= 70; d++) {
        const i = ((hint + d) % this.count + this.count) % this.count;
        const p = this.points[i];
        const dx = pos.x - p.x, dz = pos.z - p.z;
        const sq = dx * dx + dz * dz;
        if (sq < bestSq) { bestSq = sq; best = i; }
      }
      if (bestSq > 60 * 60) best = -1; // drifted out of the window, fall back
    }
    if (best < 0) {
      for (let i = 0; i < this.count; i += 4) {
        const p = this.points[i];
        const dx = pos.x - p.x, dz = pos.z - p.z;
        const sq = dx * dx + dz * dz;
        if (sq < bestSq) { bestSq = sq; best = i; }
      }
      for (let d = -4; d <= 4; d++) {
        const i = ((best + d) % this.count + this.count) % this.count;
        const p = this.points[i];
        const dx = pos.x - p.x, dz = pos.z - p.z;
        const sq = dx * dx + dz * dz;
        if (sq < bestSq) { bestSq = sq; best = i; }
      }
    }

    const point = this.points[best];
    const normal = this.normals[best];
    const lateral = (pos.x - point.x) * normal.x + (pos.z - point.z) * normal.z;
    return { index: best, point, normal, tangent: this.tangents[best], lateral, arc: this.arc[best] };
  }

  /** World position `offset` metres to the side of centreline sample `i`. */
  offsetPoint(i, offset, out = new THREE.Vector3()) {
    const p = this.at(i), n = this.normalAt(i);
    return out.set(p.x + n.x * offset, 0, p.z + n.z * offset);
  }

  /** Grid slot for the nth car: staggered two-by-two behind the line. */
  gridSlot(n) {
    const row = Math.floor(n / 2);
    const i = this.startIndex - 14 - row * 16;
    const side = (n % 2 === 0 ? -1 : 1) * 4.6;
    const pos = this.offsetPoint(i, side);
    const t = this.tangentAt(i);
    return { position: pos, yaw: Math.atan2(t.x, t.z) };
  }

  build() {
    const group = new THREE.Group();
    group.name = 'track';
    group.add(this.#road(), this.#kerbs(), this.#laneMarkings(), this.#barriers(), this.#startLine());
    return group;
  }

  #ribbon(inner, outer, y, material) {
    const n = this.count;
    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const idx = [];

    for (let i = 0; i < n; i++) {
      const p = this.points[i], nm = this.normals[i];
      const o = i * 6;
      pos[o + 0] = p.x + nm.x * inner; pos[o + 1] = y; pos[o + 2] = p.z + nm.z * inner;
      pos[o + 3] = p.x + nm.x * outer; pos[o + 4] = y; pos[o + 5] = p.z + nm.z * outer;
      const v = this.arc[i] / 14;
      uv[i * 4 + 0] = 0; uv[i * 4 + 1] = v;
      uv[i * 4 + 2] = 1; uv[i * 4 + 3] = v;
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = a + 1, c = ((i + 1) % n) * 2, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }

  #road() {
    const mat = new THREE.MeshStandardMaterial({
      // White base — the asphalt canvas carries the colour, and multiplying it
      // by a dark tint again crushes the road to black.
      color: 0xffffff, roughness: 0.92, metalness: 0.04,
      map: asphaltTexture(), envMapIntensity: 0.5
    });
    const mesh = this.#ribbon(-this.halfWidth, this.halfWidth, 0, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  #kerbs() {
    const group = new THREE.Group();
    const n = this.count;
    const seg = 10; // samples per red/white block

    for (const side of [-1, 1]) {
      const pos = [], colors = [], idx = [];
      const inner = side * this.halfWidth;
      const outer = side * (this.halfWidth + 1.3);
      for (let i = 0; i < n; i++) {
        const p = this.points[i], nm = this.normals[i];
        pos.push(p.x + nm.x * inner, 0.06, p.z + nm.z * inner);
        pos.push(p.x + nm.x * outer, 0.14, p.z + nm.z * outer);
        const red = Math.floor(i / seg) % 2 === 0;
        const c = red ? [0.78, 0.09, 0.14] : [0.92, 0.92, 0.9];
        colors.push(...c, ...c);
      }
      for (let i = 0; i < n; i++) {
        const a = i * 2, b = a + 1, c = ((i + 1) % n) * 2, d = c + 1;
        if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })));
    }
    return group;
  }

  #laneMarkings() {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xf0ece0, transparent: true, opacity: 0.8 });
    const dash = new THREE.PlaneGeometry(0.22, 5.5);
    for (let i = 0; i < this.count; i += 22) {
      for (const off of [-4.2, 4.2]) {
        const m = new THREE.Mesh(dash, mat);
        const p = this.offsetPoint(i, off);
        const t = this.tangentAt(i);
        m.position.set(p.x, 0.02, p.z);
        m.rotation.set(-Math.PI / 2, 0, -Math.atan2(t.x, t.z));
        group.add(m);
      }
    }
    return group;
  }

  #barriers() {
    const group = new THREE.Group();
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8e8b80, roughness: 0.9 });
    // Painted stripes along the top of the wall, one colour per side.
    const neon = new THREE.MeshBasicMaterial({ color: 0x1f9ad6 });
    const neonWarm = new THREE.MeshBasicMaterial({ color: 0xd8232f });

    for (const side of [-1, 1]) {
      const base = side * (this.halfWidth + 1.4);
      const wall = this.#ribbonWall(base, 1.15, concrete, side);
      group.add(wall);
      // A thin painted strip along the top of the wall — reads as speed.
      const strip = this.#ribbon(base - side * 0.06, base + side * 0.06, 1.17, side > 0 ? neon : neonWarm);
      group.add(strip);
    }
    return group;
  }

  #ribbonWall(offset, height, material, side) {
    const n = this.count;
    const pos = [], idx = [];
    for (let i = 0; i < n; i++) {
      const p = this.points[i], nm = this.normals[i];
      const x = p.x + nm.x * offset, z = p.z + nm.z * offset;
      pos.push(x, 0, z, x, height, z);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = a + 1, c = ((i + 1) % n) * 2, d = c + 1;
      if (side < 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }

  #startLine() {
    const group = new THREE.Group();
    const i = this.startIndex;
    const p = this.at(i), t = this.tangentAt(i);
    const yaw = -Math.atan2(t.x, t.z);

    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfWidth * 2, 3),
      new THREE.MeshBasicMaterial({ map: checkerTexture(), transparent: true })
    );
    line.position.set(p.x, 0.03, p.z);
    line.rotation.set(-Math.PI / 2, 0, yaw);
    group.add(line);

    // Gantry over the road, in the style of a Nathan Road shop banner.
    const gantry = new THREE.Group();
    const legGeo = new THREE.CylinderGeometry(0.32, 0.36, 9, 10);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x4a505c, roughness: 0.6, metalness: 0.5 });
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(s * (this.halfWidth + 1), 4.5, 0);
      gantry.add(leg);
    }
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(this.halfWidth * 2 + 3, 2.4, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x1b2233, roughness: 0.6 })
    );
    banner.position.y = 8.4;
    gantry.add(banner);

    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfWidth * 2 + 2.6, 2.1),
      new THREE.MeshBasicMaterial({ map: signTexture('起點 START / FINISH', '#ffd45c', '#1b2233'), transparent: true })
    );
    face.position.set(0, 8.4, 0.28);
    gantry.add(face);
    const faceBack = face.clone();
    faceBack.position.z = -0.28;
    faceBack.rotation.y = Math.PI;
    gantry.add(faceBack);

    gantry.position.set(p.x, 0, p.z);
    gantry.rotation.y = Math.atan2(t.x, t.z);
    group.add(gantry);

    return group;
  }
}

// ---------------------------------------------------------------------------
// Procedural textures (no binary assets — the whole game ships as source).
// ---------------------------------------------------------------------------

let _asphalt;
function asphaltTexture() {
  if (_asphalt) return _asphalt;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#43454c';
  g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // A few patch repairs, because it is a public road.
  g.globalAlpha = 0.25;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = Math.random() > 0.5 ? '#383a41' : '#4f515a';
    g.fillRect(Math.random() * 256, Math.random() * 256, 20 + Math.random() * 60, 12 + Math.random() * 40);
  }
  _asphalt = new THREE.CanvasTexture(c);
  _asphalt.wrapS = _asphalt.wrapT = THREE.RepeatWrapping;
  _asphalt.repeat.set(6, 1);
  _asphalt.anisotropy = 8;
  return _asphalt;
}

let _checker;
function checkerTexture() {
  if (_checker) return _checker;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#f2f2f2' : '#0d0d10';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  _checker = new THREE.CanvasTexture(c);
  return _checker;
}

export function signTexture(text, color = '#ff2d78', bg = 'transparent', vertical = false) {
  const c = document.createElement('canvas');
  c.width = vertical ? 128 : 1024;
  c.height = vertical ? 1024 : 128;
  const g = c.getContext('2d');
  if (bg !== 'transparent') { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 26;
  g.fillStyle = color;

  if (vertical) {
    const chars = [...text];
    const size = Math.min(96, 900 / chars.length);
    g.font = `700 ${size}px "PingFang HK", "Microsoft JhengHei", "Noto Sans TC", sans-serif`;
    chars.forEach((ch, i) => g.fillText(ch, c.width / 2, (i + 0.6) * (960 / chars.length)));
  } else {
    g.font = '700 74px "PingFang HK", "Microsoft JhengHei", "Noto Sans TC", Avenir Next, sans-serif';
    g.fillText(text, c.width / 2, c.height / 2 + 4);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}
