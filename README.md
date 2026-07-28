# 極速香港 · Claude for Speed — Hong Kong

A browser street racer set on a fictional Victoria Harbour circuit, driven in a
bright Hong Kong afternoon. Pick a red taxi, a green minibus, an ice cream van
or an old-school double decker and race them around the waterfront.

Built with Three.js and Vite. Every model, texture and sound is generated at
run time — there are no binary assets in the repository.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
npm test         # headless handling + AI tests
```

## The roster

| Vehicle | | Character |
|---|---|---|
| 紅的 | **Red Taxi** | Urban red Crown Comfort. Fastest, sharpest, least forgiving of contact. |
| 綠色小巴 | **Green Minibus** | 16 seats, no seatbelts. Quick, tall, and permanently late. |
| 雪糕車 | **Ice Cream Van** | Soft-serve swirl on the roof. Slowest, but the nitrous plays the jingle. |
| 舊款雙層巴士 | **Double Decker** | Non-aircon "hot dog" bus. 11 tonnes. Understeers like a barge, wins every collision. |

Reverse is on the brake: hold it for a beat once you have stopped and the car
backs up at a manoeuvring crawl. Throttle gets you going forwards again.

## Modes

- **街頭賽 Quick Race** — four AI rivals, one of each other vehicle, grid start
  with a countdown. Difficulty ranges from Tourist to Minibus Driver.
- **計時賽 Time Attack** — alone against the clock.
- **自由行 Free Roam** — no timer, no rivals, no laps.

## Controls

| | |
|---|---|
| `W` / `↑` | Throttle |
| `S` / `↓` | Brake. Keep it held for a moment once stopped and the car reverses |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake |
| `Shift` | Nitrous |
| `C` | Cycle chase / bonnet / cinematic camera |
| `R` | Respawn on the racing line |
| `H` | Dim or hide the on-screen control legend |
| `P` / `Esc` | Pause |
| `M` | Mute |

## How it fits together

| File | Responsibility |
|---|---|
| `src/main.js` | Scene assembly, race state machine, camera, render loop |
| `src/track.js` | The circuit spline — road, kerbs, barriers and start gantry are all derived from it |
| `src/city.js` | Harbour, promenade, skyline, signboards, trams and boats |
| `src/vehicles.js` | The roster: handling specs plus a procedural model for each vehicle |
| `src/physics.js` | Bicycle-model vehicle dynamics, barrier and car-to-car collisions |
| `src/ai.js` | Rival drivers: racing line, corner speed, overtaking, personality |
| `src/effects.js` | Pooled skidmarks and particles |
| `src/audio.js` | Synthesised engine, tyre squeal, impacts and the ice cream jingle |
| `src/ui.js` | Garage, HUD, pause and results screens |
| `src/minimap.js` | Canvas minimap |

### Vehicle physics

Each car is a bicycle model stepped at 120 Hz. Per-axle slip angles feed a
saturating tyre curve whose peak scales with the load on that axle, so
longitudinal weight transfer changes the balance under power and braking — and a
vehicle with a high centre of gravity, like the double decker, transfers far more
of it. Cornering forces eat into the grip available for acceleration through a
friction-ellipse term, and the handbrake simply drops rear-axle grip. Collisions
resolve analytically against the track spline rather than against mesh geometry.

### Racing line

The AI samples curvature ahead of itself to work out how hard the next corner
is, derives a grip-limited entry speed from it, and aims at a point on the
spline offset toward the apex. Each driver has its own line bias, aggression,
reaction lag and an occasional deliberate mistake, and the field rubber-bands
gently toward the player so a race in the bus is still a race.

A driver that noses into a barrier shunts backwards to free itself. If it still
has not covered 25 metres after six seconds — wedged, or facing the wrong way
after a spin, neither of which reversing fixes — it is quietly put back on the
racing line, the same recovery the player gets from `R`.

### Tests

`npm test` runs `test/handling.test.mjs` under the Node test runner. The physics,
track and AI modules are free of DOM and WebGL, so a full lap simulates in
milliseconds and the tests assert on behaviour rather than pixels: that steering
input actually changes heading, that every vehicle develops real cornering force,
that a car which clips a barrier recovers instead of spinning, and that all four
AI drivers complete a lap while staying on the road.

### Debugging

The running game is exposed as `window.cfs`, so `cfs.player`, `cfs.track` and
`cfs.camera` can be poked at from the browser console.
