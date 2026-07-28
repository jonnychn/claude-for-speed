// AI drivers: look ahead down the spline, pick a line, and defend it.
// Each rival gets a personality so the pack doesn't drive as one organism.

import * as THREE from 'three';
import { forwardVector, rightVector, speed } from './physics.js';

const NAMES = [
  { zh: '亞德', en: 'Ah Tak' },
  { zh: '肥仔強', en: 'Fei Jai Keung' },
  { zh: '珍姐', en: 'Jane Tse' },
  { zh: '阿蛇', en: 'Sir Ho' },
  { zh: '細路明', en: 'Siu Ming' },
  { zh: '黃師傅', en: 'Master Wong' },
  { zh: '阿彩', en: 'Ah Choi' }
];

export function driverName(i) {
  return NAMES[i % NAMES.length];
}

export function createDriver(seed, skill) {
  return {
    skill,                                   // 0.85 (easy) .. 1.06 (nightmare)
    lineBias: (hash(seed) - 0.5) * 0.9,      // preferred side of the road
    aggression: 0.55 + hash(seed + 7) * 0.45,
    reaction: 0.08 + hash(seed + 13) * 0.14, // steering lag, in seconds
    boostGreed: hash(seed + 19),
    steerState: 0,
    avoidOffset: 0,
    mistake: 0,
    mistakeTimer: 4 + hash(seed + 31) * 12
  };
}

const _v = new THREE.Vector3();
const _target = new THREE.Vector3();

/**
 * @param car   { body, driver, near } — near is the last Track.nearest() result
 * @param rivals other cars to avoid (including the player)
 * @param rubber >1 speeds the AI up when it's behind the player
 */
export function driveAI(car, track, rivals, dt, rubber = 1) {
  const { body, driver, near } = car;
  const spd = speed(body);
  const perMetre = track.count / track.length;

  // --- occasional human error ------------------------------------------
  driver.mistakeTimer -= dt;
  if (driver.mistakeTimer <= 0) {
    driver.mistakeTimer = 7 + Math.random() * 16;
    driver.mistake = (Math.random() - 0.5) * 1.6 * (1.15 - driver.skill);
  }
  driver.mistake *= 1 - Math.min(1, dt * 0.8);

  // --- pick the line ----------------------------------------------------
  const lookahead = 9 + spd * 0.95;
  const targetIndex = near.index + Math.round(lookahead * perMetre);

  // Apex-seeking: hug the inside of the corner we're in, drift out on exit.
  const kNow = track.curvatureAt(near.index + Math.round(12 * perMetre));
  const usable = track.halfWidth - body.spec.width * 0.5 - 1.2;
  const apex = THREE.MathUtils.clamp(kNow * 260, -1, 1) * usable * 0.85;

  // --- avoid the car in front -------------------------------------------
  let avoid = 0;
  for (const other of rivals) {
    if (other === car) continue;
    _v.subVectors(other.body.pos, body.pos);
    const dist = _v.length();
    if (dist > 34 || dist < 0.01) continue;
    const ahead = _v.dot(forwardVector(body.yaw, _target));
    if (ahead < 1) continue;
    const side = _v.dot(rightVector(body.yaw, _target));
    if (Math.abs(side) > 5.5) continue;
    // Dive for whichever side has more room.
    const room = (other.near?.lateral ?? 0);
    const dir = room > 0 ? -1 : 1;
    avoid += dir * (1 - ahead / 34) * 6.5 * driver.aggression;
  }
  driver.avoidOffset += (avoid - driver.avoidOffset) * Math.min(1, dt * 3.5);

  const wantLateral = THREE.MathUtils.clamp(
    apex + driver.lineBias * usable * 0.35 + driver.avoidOffset + driver.mistake * 2.2,
    -usable, usable
  );

  track.offsetPoint(targetIndex, wantLateral, _target);

  // --- steer toward it ---------------------------------------------------
  _v.subVectors(_target, body.pos);
  const fwd = forwardVector(body.yaw);
  const rgt = rightVector(body.yaw);
  const angle = Math.atan2(_v.dot(rgt), Math.max(0.5, _v.dot(fwd)));
  const wantSteer = THREE.MathUtils.clamp(angle * 1.9, -1, 1);
  driver.steerState += (wantSteer - driver.steerState) * Math.min(1, dt / driver.reaction);

  // --- how fast dare we go ----------------------------------------------
  const probe = 22 + spd * 1.7;
  const worst = track.worstCurvature(near.index + Math.round(6 * perMetre), probe);
  const gripLimit = worst > 1e-4
    ? Math.sqrt((body.spec.grip * 9.81 * 0.92) / worst)
    : Infinity;

  const cap = body.spec.topSpeed * driver.skill * rubber;
  const targetSpeed = Math.min(cap, gripLimit * driver.skill);
  const error = targetSpeed - spd;

  let throttle = 0, brake = 0;
  if (error > 1.5) throttle = 1;
  else if (error > -0.5) throttle = 0.45;
  else brake = THREE.MathUtils.clamp(-error / 9, 0.12, 1);

  // Off the racing surface? Back off and get back on.
  if (Math.abs(near.lateral) > track.halfWidth) { throttle *= 0.55; brake = Math.max(brake, 0.2); }

  // Handbrake only when it's genuinely pointing the wrong way.
  const handbrake = (Math.abs(angle) > 0.95 && spd > 12 && driver.aggression > 0.8) ? 1 : 0;

  // Boost down the straights.
  const boost = (gripLimit > cap * 1.15 && spd > cap * 0.45 && driver.boostGreed > 0.25) ? 1 : 0;

  return { throttle, brake, steer: driver.steerState, handbrake, boost };
}

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
