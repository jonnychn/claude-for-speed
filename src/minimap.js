// North-up canvas minimap. The circuit outline is cached to an offscreen
// canvas once; only the car dots are redrawn each frame.

export class Minimap {
  constructor(canvas, track) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.track = track;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.size = 178;
    canvas.width = canvas.height = this.size * dpr;
    canvas.style.width = canvas.style.height = this.size + 'px';
    this.ctx.scale(dpr, dpr);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 12;
    this.scale = Math.min((this.size - pad * 2) / (maxX - minX), (this.size - pad * 2) / (maxZ - minZ));
    this.cx = (minX + maxX) / 2;
    this.cz = (minZ + maxZ) / 2;

    this.base = document.createElement('canvas');
    this.base.width = this.base.height = this.size * dpr;
    const b = this.base.getContext('2d');
    b.scale(dpr, dpr);
    this.#drawTrack(b);
  }

  project(x, z) {
    return [
      this.size / 2 + (x - this.cx) * this.scale,
      this.size / 2 + (z - this.cz) * this.scale
    ];
  }

  #drawTrack(g) {
    g.clearRect(0, 0, this.size, this.size);

    // Harbour fill inside the loop.
    g.beginPath();
    this.track.points.forEach((p, i) => {
      const [x, y] = this.project(p.x, p.z);
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    });
    g.closePath();
    g.fillStyle = 'rgba(35,120,160,0.5)';
    g.fill();

    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = this.track.halfWidth * 2 * this.scale;
    g.lineJoin = g.lineCap = 'round';
    g.stroke();

    g.strokeStyle = 'rgba(33,230,255,0.55)';
    g.lineWidth = 1.4;
    g.stroke();

    // Start/finish tick.
    const i = this.track.startIndex;
    const p = this.track.at(i), n = this.track.normalAt(i);
    const a = this.project(p.x + n.x * 14, p.z + n.z * 14);
    const b = this.project(p.x - n.x * 14, p.z - n.z * 14);
    g.beginPath();
    g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
    g.strokeStyle = '#ffc542';
    g.lineWidth = 2.5;
    g.stroke();
  }

  draw(cars, playerCar) {
    const g = this.ctx;
    g.clearRect(0, 0, this.size, this.size);
    g.drawImage(this.base, 0, 0, this.size, this.size);

    for (const car of cars) {
      if (car === playerCar) continue;
      const [x, y] = this.project(car.body.pos.x, car.body.pos.z);
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fillStyle = car.color || '#ff2d78';
      g.fill();
    }

    if (playerCar) {
      const [x, y] = this.project(playerCar.body.pos.x, playerCar.body.pos.z);
      g.save();
      g.translate(x, y);
      g.rotate(-playerCar.body.yaw + Math.PI);
      g.beginPath();
      g.moveTo(0, -6); g.lineTo(4.4, 5); g.lineTo(0, 2.6); g.lineTo(-4.4, 5);
      g.closePath();
      g.fillStyle = '#ffffff';
      g.shadowColor = '#21e6ff';
      g.shadowBlur = 8;
      g.fill();
      g.restore();
    }
  }
}
