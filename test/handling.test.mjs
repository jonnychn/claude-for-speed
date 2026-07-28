// Headless handling tests. The physics, track and AI modules are all pure —
// no DOM, no WebGL — so a lap can be simulated far faster than real time.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { Track } from '../src/track.js';
import { createBody, step, clampToTrack, resolveCarCollision, speed } from '../src/physics.js';
import { createDriver, driveAI } from '../src/ai.js';
import { VEHICLES, getVehicle } from '../src/vehicles.js';

const DT = 1 / 120;
const track = new Track();

function spawn(def, gridIndex = 0) {
  const slot = track.gridSlot(gridIndex);
  const body = createBody(def.spec, slot.position, slot.yaw);
  return { def, body, near: track.nearest(body.pos) };
}

function advance(car, input) {
  step(car.body, input, DT);
  car.near = clampToTrack(car.body, track, car.near.index).near;
}

/** Arc length travelled from the start line, unwrapping laps. */
function makeOdometer(car) {
  const startArc = track.arc[track.startIndex];
  const s = () => (car.near.arc - startArc + track.length) % track.length;
  let last = s();
  let laps = 0;
  return {
    tick() {
      const now = s();
      if (now - last < -track.length / 2) laps += 1;
      else if (now - last > track.length / 2) laps -= 1;
      last = now;
    },
    get distance() { return laps * track.length + last; }
  };
}

test('a steered car actually changes heading', () => {
  const car = spawn(getVehicle('taxi'));
  for (let i = 0; i < 360; i++) advance(car, { throttle: 1, brake: 0, steer: 0, handbrake: 0, boost: 0 });

  const yawBefore = car.body.yaw;
  const lateralBefore = car.near.lateral;
  for (let i = 0; i < 120; i++) advance(car, { throttle: 1, brake: 0, steer: 1, handbrake: 0, boost: 0 });

  const turned = Math.abs(car.body.yaw - yawBefore);
  assert.ok(turned > 0.2, `one second of full lock should turn the car; got ${turned.toFixed(3)} rad`);
  assert.ok(
    Math.abs(car.near.lateral - lateralBefore) > 1,
    'steering should move the car across the road'
  );
});

test('every vehicle generates real cornering force', () => {
  for (const def of VEHICLES) {
    const s = def.spec;
    const load = s.mass * 9.81 * 0.5;
    const car = spawn(def);
    for (let i = 0; i < 240; i++) advance(car, { throttle: 1, brake: 0, steer: 0, handbrake: 0, boost: 0 });

    const yawBefore = car.body.yaw;
    for (let i = 0; i < 120; i++) advance(car, { throttle: 0.6, brake: 0, steer: 1, handbrake: 0, boost: 0 });
    const turned = Math.abs(car.body.yaw - yawBefore);

    assert.ok(turned > 0.1, `${def.en} barely turns (${turned.toFixed(3)} rad) — check the tyre model`);
    // Sanity check the peak force is on a physical scale, not a few newtons.
    assert.ok(s.grip * load > 1000, `${def.en} peak axle force is implausibly small`);
  }
});

test('a glancing hit on the barrier does not send a car into a permanent spin', () => {
  const car = spawn(getVehicle('taxi'));
  for (let i = 0; i < 360; i++) advance(car, { throttle: 1, brake: 0, steer: 0, handbrake: 0, boost: 0 });

  // Drive into the wall, then straighten up and carry on.
  for (let i = 0; i < 200; i++) advance(car, { throttle: 1, brake: 0, steer: 0.55, handbrake: 0, boost: 0 });
  let worst = 0;
  for (let i = 0; i < 600; i++) {
    advance(car, { throttle: 0.6, brake: 0, steer: 0, handbrake: 0, boost: 0 });
    worst = Math.max(worst, Math.abs(car.body.r));
  }

  assert.ok(worst < 2.6, `yaw rate ran away after wall contact: ${worst.toFixed(2)} rad/s`);
  assert.ok(
    Math.abs(car.body.r) < 0.35,
    `car is still spinning long after the hit: ${car.body.r.toFixed(2)} rad/s`
  );
});

test('AI drivers complete a lap of the circuit', () => {
  const cars = VEHICLES.map((def, i) => {
    const car = spawn(def, i);
    car.driver = createDriver(i * 977 + 13, 0.94);
    car.odo = makeOdometer(car);
    return car;
  });

  const steps = 120 * 150; // 150 seconds of simulation
  let worstYaw = 0;
  let offTrackSamples = 0;

  for (let n = 0; n < steps; n++) {
    for (const car of cars) advance(car, driveAI(car, track, cars, DT));
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) resolveCarCollision(cars[i].body, cars[j].body);
    }
    for (const car of cars) {
      car.odo.tick();
      worstYaw = Math.max(worstYaw, Math.abs(car.body.r));
      if (Math.abs(car.near.lateral) > track.halfWidth) offTrackSamples++;
    }
  }

  for (const car of cars) {
    assert.ok(
      car.odo.distance > track.length,
      `${car.def.en} covered only ${car.odo.distance.toFixed(0)}m of the ${track.length.toFixed(0)}m lap`
    );
    assert.ok(speed(car.body) > 8, `${car.def.en} ended up stationary`);
  }

  assert.ok(worstYaw < 3, `an AI car span up to ${worstYaw.toFixed(2)} rad/s`);
  const offTrackFraction = offTrackSamples / (steps * cars.length);
  assert.ok(offTrackFraction < 0.12, `AI spent ${(offTrackFraction * 100).toFixed(1)}% of the time off track`);
});
