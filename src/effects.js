// Skidmarks, tyre smoke and nitrous plumes. Both systems are fixed-size pools,
// so a twenty-minute session allocates exactly as much as the first lap.

import * as THREE from 'three';

const MAX_MARKS = 2200;
const MAX_PARTICLES = 1400;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.#initSkids();
    this.#initParticles();
  }

  // -- skidmarks ------------------------------------------------------------
  #initSkids() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false
    });
    this.skids = new THREE.InstancedMesh(geo, mat, MAX_MARKS);
    this.skids.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.skids.frustumCulled = false;
    this.skids.count = MAX_MARKS;
    this.skidIndex = 0;

    // Park every instance under the map until it's used.
    const m = new THREE.Matrix4().makeTranslation(0, -500, 0);
    for (let i = 0; i < MAX_MARKS; i++) this.skids.setMatrixAt(i, m);
    this.skids.instanceMatrix.needsUpdate = true;
    this.scene.add(this.skids);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  emitSkid(x, z, yaw, width, length) {
    this._e.set(0, yaw, 0);
    this._q.setFromEuler(this._e);
    this._p.set(x, 0.012, z);
    this._s.set(width, 1, length);
    this._m.compose(this._p, this._q, this._s);
    this.skids.setMatrixAt(this.skidIndex, this._m);
    this.skidIndex = (this.skidIndex + 1) % MAX_MARKS;
    this.skids.instanceMatrix.needsUpdate = true;
  }

  clearSkids() {
    const m = new THREE.Matrix4().makeTranslation(0, -500, 0);
    for (let i = 0; i < MAX_MARKS; i++) this.skids.setMatrixAt(i, m);
    this.skids.instanceMatrix.needsUpdate = true;
    this.skidIndex = 0;
  }

  // -- particles ------------------------------------------------------------
  #initParticles() {
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const colors = new Float32Array(MAX_PARTICLES * 3);
    const alphas = new Float32Array(MAX_PARTICLES);
    const sizes = new Float32Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) positions[i * 3 + 1] = -500;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: { map: { value: puffTexture() } },
      vertexShader: `
        attribute float alpha;
        attribute float size;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vAlpha = alpha;
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (320.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
          if (gl_FragColor.a < 0.01) discard;
        }`,
      vertexColors: true
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    this.pool = new Array(MAX_PARTICLES).fill(null).map(() => ({
      life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, size: 1, grow: 1, fade: 1
    }));
    this.pIndex = 0;
  }

  emitParticle(x, y, z, vx, vy, vz, color, size, life, grow = 2.2) {
    const i = this.pIndex;
    this.pIndex = (this.pIndex + 1) % MAX_PARTICLES;

    const p = this.pool[i];
    p.life = life; p.maxLife = life;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.size = size; p.grow = grow;

    const pos = this.points.geometry.attributes.position.array;
    const col = this.points.geometry.attributes.color.array;
    const alp = this.points.geometry.attributes.alpha.array;
    const siz = this.points.geometry.attributes.size.array;

    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b;
    alp[i] = 1;
    siz[i] = size;
  }

  update(dt) {
    const pos = this.points.geometry.attributes.position.array;
    const alp = this.points.geometry.attributes.alpha.array;
    const siz = this.points.geometry.attributes.size.array;
    let dirty = false;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.pool[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      dirty = true;

      if (p.life <= 0) { pos[i * 3 + 1] = -500; alp[i] = 0; continue; }

      pos[i * 3] += p.vx * dt;
      pos[i * 3 + 1] += p.vy * dt;
      pos[i * 3 + 2] += p.vz * dt;
      p.vx *= 1 - dt * 1.4;
      p.vz *= 1 - dt * 1.4;
      p.vy += dt * 0.6;

      const t = p.life / p.maxLife;
      alp[i] = t * t * 0.75;
      siz[i] = p.size * (1 + (1 - t) * p.grow);
    }

    if (dirty) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.alpha.needsUpdate = true;
      this.points.geometry.attributes.size.needsUpdate = true;
    }
  }

  reset() {
    this.clearSkids();
    const pos = this.points.geometry.attributes.position.array;
    for (let i = 0; i < MAX_PARTICLES; i++) { this.pool[i].life = 0; pos[i * 3 + 1] = -500; }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

let _puff;
function puffTexture() {
  if (_puff) return _puff;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _puff = new THREE.CanvasTexture(c);
  return _puff;
}
