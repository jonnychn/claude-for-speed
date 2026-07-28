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
```

## The roster

| Vehicle | | Character |
|---|---|---|
| 紅的 | **Red Taxi** | Urban red Crown Comfort. Fastest, sharpest, least forgiving of contact. |
| 綠色小巴 | **Green Minibus** | 16 seats, no seatbelts. Quick, tall, and permanently late. |
| 雪糕車 | **Ice Cream Van** | Soft-serve swirl on the roof. Slowest, but the nitrous plays the jingle. |
| 舊款雙層巴士 | **Double Decker** | Non-aircon "hot dog" bus. 11 tonnes. Understeers like a barge, wins every collision. |

## Modes

- **街頭賽 Quick Race** — four AI rivals, one of each other vehicle, grid start
  with a countdown. Difficulty ranges from Tourist to Minibus Driver.
- **計時賽 Time Attack** — alone against the clock.
- **自由行 Free Roam** — no timer, no rivals, no laps.

## Controls

| | |
|---|---|
| `W A S D` / arrows | Steer, throttle, brake (hold brake at a stop to reverse) |
| `Space` | Handbrake |
| `Shift` | Nitrous |
| `C` | Cycle chase / bonnet / cinematic camera |
| `R` | Respawn on the racing line |
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

### Debugging

The running game is exposed as `window.cfs`, so `cfs.player`, `cfs.track` and
`cfs.camera` can be poked at from the browser console.
