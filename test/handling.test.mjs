// Headless handling tests. The physics, track and AI modules are all pure —
// no DOM, no WebGL — so a lap can be simulated far faster than real time.
//
// Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Track } from '../src/track.js';
import { createBody, step, clampToTrack, resolveCarCollision, speed, forwardVector } from '../src/physics.js';
import { createDriver, driveAI, takeRescue } from '../src/ai.js';
import { VEHICLES, getVehicle } from '../src/vehicles.js';

const DT = 1 / 120;
const track = new Track();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The direction the player means by "right": for a camera looking along the
 * car's forward vector with Y up, screen right is forward x up.
 */
function screenRight(yaw) {
  return new THREE.Vector3().crossVectors(forwardVector(yaw), UP);
}

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

test('steering right goes right, and left goes left', () => {
  for (const [label, input, expect] of [['right', 1, 1], ['left', -1, -1]]) {
    const car = spawn(getVehicle('taxi'));
    for (let i = 0; i < 240; i++) advance(car, { throttle: 1, brake: 0, steer: 0, handbrake: 0, boost: 0 });

    const from = car.body.pos.clone();
    const right0 = screenRight(car.body.yaw);
    for (let i = 0; i < 150; i++) {
      advance(car, { throttle: 0.7, brake: 0, steer: input, handbrake: 0, boost: 0 });
    }

    const sideways = car.body.pos.clone().sub(from).dot(right0);
    const heading = forwardVector(car.body.yaw).dot(right0);

    assert.ok(
      Math.sign(sideways) === expect && Math.abs(sideways) > 1,
      `steering ${label} moved the car ${sideways.toFixed(1)}m to the ` +
      `${sideways > 0 ? 'right' : 'left'} — steering is inverted`
    );
    assert.ok(
      Math.sign(heading) === expect,
      `steering ${label} swung the nose the wrong way`
    );
  }
});

test('the body rolls to the outside of a corner', () => {
  const car = spawn(getVehicle('bus'));
  for (let i = 0; i < 300; i++) advance(car, { throttle: 1, brake: 0, steer: 0, handbrake: 0, boost: 0 });
  for (let i = 0; i < 90; i++) advance(car, { throttle: 0.7, brake: 0, steer: 1, handbrake: 0, boost: 0 });

  // Turning right should throw the body over to the left. A positive rotation
  // about the car's forward axis tips the roof right, so lean must go negative.
  assert.ok(
    car.body.lean < -0.01,
    `turning right leaned the body the wrong way (${car.body.lean.toFixed(3)})`
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

test('holding the brake at a standstill backs the car up', () => {
  const car = spawn(getVehicle('taxi'));
  for (let i = 0; i < 240; i++) advance(car, { throttle: 1, brake: 0, steer: 0, handbrake: 0, boost: 0 });

  const brake = { throttle: 0, brake: 1, steer: 0, handbrake: 0, boost: 0 };

  // Braking to a stop must not immediately fling the car backwards.
  for (let i = 0; i < 180; i++) advance(car, brake);
  assert.ok(car.body.u > -3, `braking to a stop reversed too eagerly (${car.body.u.toFixed(2)} m/s)`);

  const from = car.body.pos.clone();
  for (let i = 0; i < 480; i++) advance(car, brake);

  assert.ok(car.body.u < -2, `car did not reverse: ${(car.body.u * 3.6).toFixed(2)} km/h`);
  assert.ok(from.distanceTo(car.body.pos) > 5, 'car reversed but barely moved');

  // And it stays a manoeuvring crawl rather than winding up to road speed.
  for (let i = 0; i < 1800; i++) advance(car, brake);
  assert.ok(
    Math.abs(car.body.u) < car.body.spec.reverseTopSpeed + 1,
    `reverse ran away to ${(car.body.u * 3.6).toFixed(0)} km/h`
  );

  // Throttle gets you out of reverse again.
  for (let i = 0; i < 360; i++) advance(car, { throttle: 1, brake: 0, steer: 0, handbrake: 0, boost: 0 });
  assert.ok(car.body.u > 2, `could not drive forward out of reverse (${car.body.u.toFixed(2)} m/s)`);
});

test('the handbrake stops a car without reversing it', () => {
  const car = spawn(getVehicle('taxi'));
  for (let i = 0; i < 240; i++) advance(car, { throttle: 1, brake: 0, steer: 0, handbrake: 0, boost: 0 });
  for (let i = 0; i < 900; i++) advance(car, { throttle: 0, brake: 0, steer: 0, handbrake: 1, boost: 0 });

  assert.ok(Math.abs(car.body.u) < 0.2, `handbrake left the car moving at ${car.body.u.toFixed(2)} m/s`);
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
  let crawlingSamples = 0;
  let rescues = 0;

  // Mirrors what main.js does: a driver that gives up gets put back on the line.
  const rescue = (car) => {
    const i = car.near.index + 4;
    const t = track.tangentAt(i);
    car.body.pos.copy(track.offsetPoint(i, 0));
    car.body.yaw = Math.atan2(t.x, t.z);
    car.body.u = Math.max(0, Math.min(car.body.u, 8));
    car.body.w = 0;
    car.body.r = 0;
    car.body.reverseArm = 0;
    rescues++;
  };

  for (let n = 0; n < steps; n++) {
    for (const car of cars) {
      advance(car, driveAI(car, track, cars, DT));
      if (takeRescue(car.driver)) rescue(car);
    }
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) resolveCarCollision(cars[i].body, cars[j].body);
    }
    for (const car of cars) {
      car.odo.tick();
      worstYaw = Math.max(worstYaw, Math.abs(car.body.r));
      if (Math.abs(car.near.lateral) > track.halfWidth) offTrackSamples++;
      if (speed(car.body) < 2.5) crawlingSamples++;
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

  // The failure mode this guards against is a car wedged against a barrier for
  // the rest of the race, which a lap-distance check alone can miss.
  const crawlFraction = crawlingSamples / (steps * cars.length);
  assert.ok(crawlFraction < 0.06, `AI spent ${(crawlFraction * 100).toFixed(1)}% of the time barely moving`);
});
