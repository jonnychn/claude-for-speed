// All DOM. The game loop talks to this through a handful of setters.

import { VEHICLES } from './vehicles.js';

export const MODES = [
  { id: 'race', label: 'Quick Race', zh: '街頭賽', desc: '4 rivals, rolling start' },
  { id: 'time', label: 'Time Attack', zh: '計時賽', desc: 'Alone against the clock' },
  { id: 'roam', label: 'Free Roam', zh: '自由行', desc: 'No timer, no rivals' }
];

export const DIFFICULTIES = [
  { id: 'easy', label: 'Tourist', skill: 0.84 },
  { id: 'normal', label: 'Local', skill: 0.94 },
  { id: 'hard', label: 'Minibus Driver', skill: 1.04 }
];

export function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export class UI {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.selection = { vehicle: 'taxi', mode: 'race', laps: 3, difficulty: 'normal' };

    root.innerHTML = `
      <div id="garage" class="screen">
        <div class="panel">
          <div class="title">
            <div class="zh">極速香港</div>
            <div class="en">Claude for Speed</div>
            <div class="sub">Victoria Harbour Street Circuit</div>
          </div>

          <div class="cars">${VEHICLES.map(carCard).join('')}</div>

          <div class="opts">
            <div class="seg" id="modeSeg">${MODES.map((m, i) =>
              `<button data-mode="${m.id}" class="${i === 0 ? 'on' : ''}" title="${m.desc}">${m.zh} ${m.label}</button>`).join('')}</div>
            <div class="row">
              <div class="seg" id="lapSeg">${[2, 3, 5].map((n) =>
                `<button data-laps="${n}" class="${n === 3 ? 'on' : ''}">${n} laps</button>`).join('')}</div>
              <div class="seg" id="diffSeg">${DIFFICULTIES.map((d) =>
                `<button data-diff="${d.id}" class="${d.id === 'normal' ? 'on' : ''}">${d.label}</button>`).join('')}</div>
            </div>
          </div>

          <button class="btn primary" id="startBtn">開車 · Drive</button>

          <div class="keys">
            <b>W A S D</b> / arrows steer &nbsp;·&nbsp; <b>SPACE</b> handbrake &nbsp;·&nbsp; <b>SHIFT</b> nitrous<br>
            <b>C</b> camera &nbsp;·&nbsp; <b>R</b> respawn &nbsp;·&nbsp; <b>P</b> pause &nbsp;·&nbsp; <b>M</b> mute
          </div>
        </div>
      </div>

      <div id="hud" class="hidden">
        <div class="box tl">
          <div class="split"><span class="dim">Lap</span><span class="mid" id="hLap">1 / 3</span></div>
          <div class="split"><span class="dim">Pos</span><span class="mid" id="hPos">1 / 5</span></div>
          <div class="split"><span class="dim">Time</span><span class="mid" id="hTime">0:00.000</span></div>
        </div>
        <div class="box tr">
          <div class="dim">Last lap</div>
          <div class="mid" id="hLast">--:--.---</div>
          <div class="dim" style="margin-top:6px">Best lap</div>
          <div class="mid" id="hBest">--:--.---</div>
        </div>
        <div class="box br"><canvas id="minimap"></canvas></div>
        <div class="box bl" id="hints">
          <div class="hintrow"><span class="k">↑</span><span class="k">W</span> accelerate</div>
          <div class="hintrow"><span class="k">↓</span><span class="k">S</span> brake / reverse</div>
          <div class="hintrow"><span class="k">←</span><span class="k">→</span> steer</div>
          <div class="hintrow"><span class="k">SHIFT</span> nitrous</div>
          <div class="hintrow"><span class="k">SPACE</span> handbrake</div>
          <div class="hintrow dimmer"><span class="k">H</span> hide · <span class="k">R</span> respawn · <span class="k">P</span> pause</div>
        </div>
        <div id="speedo">
          <div class="num"><span id="hSpeed">0</span><small>KM/H</small></div>
          <div id="rev"><i id="hRev"></i></div>
          <div id="boostwrap"><i id="boost"></i></div>
          <div class="gearline">
            <span class="gear" id="hGear">N</span>
            <span class="dim" id="hCar">紅的 Red Taxi</span>
          </div>
        </div>
        <div id="toast"></div>
        <div id="countdown" class="hidden"></div>
      </div>

      <div id="pause" class="screen hidden">
        <div class="title"><div class="zh">暫停</div><div class="en">Paused</div></div>
        <div class="row">
          <button class="btn primary" id="resumeBtn">Resume</button>
          <button class="btn" id="restartBtn">Restart</button>
          <button class="btn" id="quitBtn">Garage</button>
        </div>
      </div>

      <div id="results" class="screen hidden">
        <div class="title"><div class="zh" id="rZh">完賽</div><div class="en" id="rTitle">Finish</div></div>
        <div class="table" id="rTable"></div>
        <div class="row">
          <button class="btn primary" id="againBtn">Race again</button>
          <button class="btn" id="garageBtn">Garage</button>
        </div>
      </div>
    `;

    this.el = {
      garage: root.querySelector('#garage'),
      hud: root.querySelector('#hud'),
      pause: root.querySelector('#pause'),
      results: root.querySelector('#results'),
      lap: root.querySelector('#hLap'),
      pos: root.querySelector('#hPos'),
      time: root.querySelector('#hTime'),
      last: root.querySelector('#hLast'),
      best: root.querySelector('#hBest'),
      speed: root.querySelector('#hSpeed'),
      rev: root.querySelector('#hRev'),
      boost: root.querySelector('#boost'),
      gear: root.querySelector('#hGear'),
      car: root.querySelector('#hCar'),
      toast: root.querySelector('#toast'),
      countdown: root.querySelector('#countdown'),
      minimap: root.querySelector('#minimap'),
      hints: root.querySelector('#hints'),
      rTable: root.querySelector('#rTable'),
      rTitle: root.querySelector('#rTitle'),
      rZh: root.querySelector('#rZh')
    };

    this.#wire();
    this.selectVehicle('taxi');
  }

  #wire() {
    const r = this.root;

    r.querySelectorAll('.car').forEach((card) => {
      card.addEventListener('click', () => this.selectVehicle(card.dataset.id));
    });

    r.querySelector('#modeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.#setSeg('#modeSeg', b);
      this.selection.mode = b.dataset.mode;
      r.querySelector('#lapSeg').style.opacity = this.selection.mode === 'roam' ? 0.35 : 1;
      r.querySelector('#diffSeg').style.opacity = this.selection.mode === 'race' ? 1 : 0.35;
    });
    r.querySelector('#lapSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.#setSeg('#lapSeg', b);
      this.selection.laps = Number(b.dataset.laps);
    });
    r.querySelector('#diffSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.#setSeg('#diffSeg', b);
      this.selection.difficulty = b.dataset.diff;
    });

    r.querySelector('#startBtn').addEventListener('click', () => this.handlers.onStart({ ...this.selection }));
    r.querySelector('#resumeBtn').addEventListener('click', () => this.handlers.onResume());
    r.querySelector('#restartBtn').addEventListener('click', () => this.handlers.onStart({ ...this.selection }));
    r.querySelector('#quitBtn').addEventListener('click', () => this.handlers.onGarage());
    r.querySelector('#againBtn').addEventListener('click', () => this.handlers.onStart({ ...this.selection }));
    r.querySelector('#garageBtn').addEventListener('click', () => this.handlers.onGarage());
  }

  #setSeg(sel, btn) {
    this.root.querySelectorAll(`${sel} button`).forEach((b) => b.classList.toggle('on', b === btn));
  }

  selectVehicle(id) {
    this.selection.vehicle = id;
    this.root.querySelectorAll('.car').forEach((c) => c.classList.toggle('on', c.dataset.id === id));
    this.handlers.onPreview?.(id);
  }

  showGarage() {
    this.el.garage.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.results.classList.add('hidden');
    this.el.pause.classList.add('hidden');
  }

  showRace(vehicleLabel) {
    this.el.garage.classList.add('hidden');
    this.el.results.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.el.car.textContent = vehicleLabel;
    this.el.hints.classList.remove('faded', 'hidden');
  }

  setPaused(on) { this.el.pause.classList.toggle('hidden', !on); }

  /** Cycle the control legend: full -> faded -> hidden. */
  cycleHints() {
    const h = this.el.hints;
    if (h.classList.contains('faded')) { h.classList.remove('faded'); h.classList.add('hidden'); }
    else if (h.classList.contains('hidden')) h.classList.remove('hidden');
    else h.classList.add('faded');
  }

  /** Dim the legend once the player is clearly driving. */
  softenHints() { this.el.hints.classList.add('faded'); }

  setHud(s) {
    const e = this.el;
    e.speed.textContent = Math.round(s.speedKmh);
    e.rev.style.width = `${Math.min(100, s.rpm * 100)}%`;
    e.boost.style.width = `${Math.max(0, s.boost) * 100}%`;
    e.gear.textContent = s.gear;
    e.lap.textContent = s.lapText;
    e.pos.textContent = s.posText;
    e.time.textContent = formatTime(s.time);
    e.last.textContent = s.lastLap ? formatTime(s.lastLap) : '--:--.---';
    e.best.textContent = s.bestLap ? formatTime(s.bestLap) : '--:--.---';
  }

  toast(text, zh = '', ms = 1600) {
    const t = this.el.toast;
    t.innerHTML = (zh ? `<span class="zh">${zh}</span>` : '') + text;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  countdown(text) {
    const c = this.el.countdown;
    if (text === null) { c.classList.add('hidden'); return; }
    c.classList.remove('hidden');
    c.textContent = text;
    c.animate(
      [{ transform: 'translate(-50%,-50%) scale(1.5)', opacity: 0 },
       { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }],
      { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }
    );
  }

  showResults(title, zh, rows) {
    this.el.rTitle.textContent = title;
    this.el.rZh.textContent = zh;
    this.el.rTable.innerHTML = rows.map((r) => `
      <div class="r ${r.me ? 'me' : ''}">
        <div class="p">${r.pos}</div>
        <div>${r.zh ? `<span style="opacity:.7">${r.zh}</span> ` : ''}${r.name}</div>
        <div class="t">${r.time}</div>
      </div>`).join('');
    this.el.results.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
  }
}

function carCard(v) {
  const bar = (label, value) => `
    <div class="mini">
      <div class="track"><i style="height:${Math.round(value * 100)}%"></i></div>
      <span>${label}</span>
    </div>`;
  return `
    <div class="car" data-id="${v.id}" style="--tint:${v.tint}">
      <div class="info">
        <div class="zh">${v.zh} <span class="en">${v.en}</span></div>
        <div class="tag">${v.tagline}</div>
      </div>
      <div class="bars">
        ${bar('SPD', v.stats.speed)}
        ${bar('ACC', v.stats.accel)}
        ${bar('GRP', v.stats.grip)}
        ${bar('BLK', v.stats.brawl)}
      </div>
    </div>`;
}
