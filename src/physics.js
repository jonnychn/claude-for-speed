// Arcade-leaning bicycle model: per-axle slip angles feed a saturating tyre curve,
// so a taxi rotates on the throttle and a double decker understeers like a barge.

import * as THREE from 'three';

const GRAVITY = 9.81;

export function createBody(spec, position, yaw) {
  return {
    spec,
    pos: position.clone(),
    yaw,
    u: 0,          // body-frame longitudinal velocity (m/s)
    w: 0,          // body-frame lateral velocity (m/s)
    r: 0,          // yaw rate (rad/s)
    steer: 0,      // current road-wheel angle (rad)
    slip: 0,       // 0..1 how sideways the tyres are, drives smoke + skids
    lean: 0,       // visual body roll (rad)
    pitch: 0,      // visual squat/dive (rad)
    wheelSpin: 0,  // wheel rotation for the visual mesh
    boost: 1,      // 0..1 nitrous tank
    boosting: false,
    impact: 0      // decays after a crunch, used for the camera shake
  };
}

export function forwardVector(yaw, out = new THREE.Vector3()) {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}

export function rightVector(yaw, out = new THREE.Vector3()) {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

export function speed(body) {
  return Math.hypot(body.u, body.w);
}

/**
 * Saturating tyre: linear near zero slip, flattens out at mu * load.
 *
 * @param slipAngle  radians
 * @param stiffness  normalised slip stiffness: the tyre saturates at roughly
 *                   1/stiffness radians of slip, so 9 means peak grip at ~6°.
 * @param gripLoad   mu * Fz for this axle, in newtons — the peak force
 * Dividing the slip term by the load here (rather than leaving it normalised)
 * cancels the load out of the whole expression and leaves the tyre making
 * `stiffness` newtons per radian, which is no cornering force at all.
 */
function tyreForce(slipAngle, stiffness, gripLoad) {
  const peak = Math.max(1, gripLoad);
  return -peak * Math.tanh(stiffness * slipAngle);
}

export function step(body, input, dt) {
  const s = body.spec;
  const m = s.mass;
  const a = s.wheelbase * s.cgBias;        // CG to front axle
  const b = s.wheelbase * (1 - s.cgBias);  // CG to rear axle
  const Iz = m * (s.wheelbase * s.wheelbase * 0.16 + s.width * s.width * 0.08);

  // --- steering ----------------------------------------------------------
  const v = Math.abs(body.u);
  const steerLimit = s.maxSteer / (1 + v * v * s.steerFalloff);
  const target = input.steer * steerLimit;
  body.steer += (target - body.steer) * Math.min(1, 12 * dt);
  const delta = body.steer;

  // --- boost -------------------------------------------------------------
  const wantsBoost = input.boost > 0 && body.boost > 0.02 && input.throttle > 0;
  body.boosting = wantsBoost;
  body.boost = THREE.MathUtils.clamp(
    body.boost + (wantsBoost ? -dt / s.boostDuration : dt / s.boostRecharge),
    0, 1
  );
  const boostMul = wantsBoost ? s.boostPower : 1;

  // --- weight transfer ---------------------------------------------------
  // Longitudinal accel shifts load between the axles; a tall bus shifts a lot more.
  const staticFront = m * GRAVITY * (1 - s.cgBias);
  const staticRear = m * GRAVITY * s.cgBias;
  // Capped fairly tightly: a real car's brake bias and suspension stop the rear
  // going light enough to snap the moment you brake in a corner.
  const transfer = THREE.MathUtils.clamp(
    (body.lastAccel || 0) * m * s.cgHeight / s.wheelbase, -staticFront * 0.45, staticRear * 0.45
  );
  const loadFront = Math.max(200, staticFront - transfer);
  const loadRear = Math.max(200, staticRear + transfer);

  const surface = body.surfaceGrip ?? 1;
  const gripFront = s.grip * surface * loadFront;
  const gripRear = s.grip * surface * loadRear * (input.handbrake ? 0.34 : 1);

  // --- slip angles -------------------------------------------------------
  const uSafe = Math.max(2.2, Math.abs(body.u)) * Math.sign(body.u || 1);
  const alphaF = Math.atan2(body.w + a * body.r, Math.abs(uSafe)) - delta * Math.sign(uSafe);
  const alphaR = Math.atan2(body.w - b * body.r, Math.abs(uSafe));

  const Fyf = tyreForce(alphaF, s.corneringFront, gripFront);
  const Fyr = tyreForce(alphaR, s.corneringRear, gripRear);

  // --- longitudinal ------------------------------------------------------
  const drive = s.engineForce * boostMul * input.throttle * powerCurve(body.u, s.topSpeed * boostMul);
  const braking = input.brake * s.brakeForce * Math.tanh(body.u * 2.5);
  const hand = input.handbrake * s.brakeForce * 0.42 * Math.tanh(body.u * 2.5);
  const rolling = s.rollingResistance * body.u;
  const drag = s.drag * body.u * Math.abs(body.u);

  // Reverse: holding brake at a standstill backs you out of the barrier.
  const reverse = (input.brake > 0 && body.u < 0.6) ? -s.engineForce * 0.32 : 0;

  let Fx = drive + reverse - braking - hand - rolling - drag;
  // Cornering eats grip that would otherwise go to acceleration (friction ellipse).
  const lateralUse = Math.min(1, Math.abs(Fyf + Fyr) / (gripFront + gripRear));
  Fx *= 1 - 0.5 * lateralUse * lateralUse;

  // --- integrate ---------------------------------------------------------
  const du = Fx / m + body.r * body.w;
  const dw = (Fyf * Math.cos(delta) + Fyr) / m - body.r * body.u;
  const dr = (a * Fyf * Math.cos(delta) - b * Fyr) / Iz;

  body.lastAccel = du;
  body.u += du * dt;
  body.w += dw * dt;
  body.r += dr * dt;

  // Yaw damping keeps the heavy stuff from spinning forever after a hit.
  body.r *= 1 - Math.min(0.5, s.yawDamping * dt);

  if (Math.abs(body.u) < 0.12 && input.throttle === 0) { body.u *= 0.86; body.w *= 0.86; body.r *= 0.86; }

  body.yaw += body.r * dt;
  const fwd = forwardVector(body.yaw);
  const rgt = rightVector(body.yaw);
  body.pos.addScaledVector(fwd, body.u * dt);
  body.pos.addScaledVector(rgt, body.w * dt);

  // --- cosmetics ---------------------------------------------------------
  const spd = speed(body);
  body.slip = THREE.MathUtils.clamp(Math.abs(body.w) / Math.max(6, spd) * 1.7, 0, 1);
  const targetLean = THREE.MathUtils.clamp(-body.r * body.u * s.rollFactor, -0.28, 0.28);
  body.lean += (targetLean - body.lean) * Math.min(1, 6 * dt);
  body.pitch += (THREE.MathUtils.clamp(-du * 0.012, -0.07, 0.07) - body.pitch) * Math.min(1, 7 * dt);
  body.wheelSpin += (body.u / s.wheelRadius) * dt;
  body.impact = Math.max(0, body.impact - dt * 2.4);

  return body;
}

/** Falling torque toward the top end, plus a hard cap so nothing runs away. */
function powerCurve(u, topSpeed) {
  if (u < 0) return 1;
  const x = u / topSpeed;
  if (x >= 1) return 0;
  return Math.min(1, 1.15 - 0.55 * x * x) * (1 - x * x * x);
}

/** Resolve a car against the road edges. Returns the impact strength (0 = clean). */
export function clampToTrack(body, track, hint) {
  const near = track.nearest(body.pos, hint);
  const halfWidth = track.halfWidth - body.spec.width * 0.5;
  const over = Math.abs(near.lateral) - halfWidth;

  body.surfaceGrip = 1;
  if (over <= 0) return { near, impact: 0 };

  const sign = Math.sign(near.lateral);
  if (over < 1.1) {
    // Kerb / painted run-off: still driveable, just slippery and noisy.
    body.surfaceGrip = 0.72;
    return { near, impact: 0 };
  }

  // Barrier. Push out, kill the inbound lateral velocity, scrub some speed.
  body.pos.addScaledVector(near.normal, -sign * (over - 1.1));

  const rgt = rightVector(body.yaw);
  const intoWall = rgt.dot(near.normal) * sign;
  const closing = body.w * intoWall;
  const impact = Math.max(0, closing) + Math.abs(body.u) * Math.abs(near.normal.dot(forwardVector(body.yaw))) * 0.25;

  body.w -= closing * intoWall * 1.55;         // bounce
  body.u *= 0.955 - Math.min(0.25, impact * 0.02);

  // Yaw kick from the corner that hit first, scaled by the closing speed we
  // just cancelled. Sizing it to the actual impact makes it a one-off impulse:
  // a constant torque here would keep spinning a car that is merely sliding
  // along the wall, since this runs every substep the car is out of bounds.
  const nose = near.normal.dot(forwardVector(body.yaw)) * sign;
  body.r -= THREE.MathUtils.clamp(nose * Math.max(0, closing) * 0.05, -0.6, 0.6);
  body.r = THREE.MathUtils.clamp(body.r, -2.5, 2.5);
  body.impact = Math.min(1, body.impact + impact * 0.06);

  return { near, impact };
}

/** Cheap circle-vs-circle push-apart between cars, weighted by mass. */
export function resolveCarCollision(a, b) {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const distSq = dx * dx + dz * dz;
  const minDist = (a.spec.length + b.spec.length) * 0.32;
  if (distSq > minDist * minDist || distSq < 1e-6) return 0;

  const dist = Math.sqrt(distSq);
  const nx = dx / dist, nz = dz / dist;
  const overlap = minDist - dist;

  const ma = a.spec.mass, mb = b.spec.mass;
  const share = ma / (ma + mb);
  a.pos.x -= nx * overlap * (1 - share); a.pos.z -= nz * overlap * (1 - share);
  b.pos.x += nx * overlap * share;       b.pos.z += nz * overlap * share;

  // Trade a bit of momentum along the contact normal. The bus wins. Always.
  const push = overlap * 9;
  applyWorldImpulse(a, -nx * push * (1 - share), -nz * push * (1 - share));
  applyWorldImpulse(b, nx * push * share, nz * push * share);

  const strength = overlap * (1 - share);
  a.impact = Math.min(1, a.impact + strength * 0.5);
  b.impact = Math.min(1, b.impact + strength * 0.5);
  return strength;
}

function applyWorldImpulse(body, ix, iz) {
  const fwd = forwardVector(body.yaw);
  const rgt = rightVector(body.yaw);
  body.u += ix * fwd.x + iz * fwd.z;
  body.w += ix * rgt.x + iz * rgt.z;
}
