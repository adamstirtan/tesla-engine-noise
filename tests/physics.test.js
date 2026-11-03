import test from 'node:test';
import assert from 'node:assert/strict';
import { GPSMotion, PedalMotion, PRESETS, gpsEngine, distanceMeters } from '../js/physics.js';

const base = 1700000000000;
function fix(speed, second = 0, overrides = {}) { return { timestamp: base + second * 1000, coords: { latitude: 43.65, longitude: -79.38, accuracy: 5, speed, ...overrides } }; }
function run(pedals, seconds, throttle = 1, brake = 0, preset = PRESETS.muscle) { let result; for (let i = 0; i < seconds * 60; i++) result = pedals.step(1 / 60, throttle, brake, true, preset); return result; }

test('GPS native speed remains in m/s; acceleration is derived and smoothed', () => {
  const gps = new GPSMotion();
  assert.equal(gps.ingest(fix(20), base).ok, true);
  assert.equal(gps.speed * 3.6, 72);
  gps.ingest(fix(22, 1), base + 1000);
  assert.ok(gps.speed > 20 && gps.speed < 22);
  assert.ok(gps.acceleration > 0 && gps.acceleration < 2);
  gps.ingest(fix(19, 2), base + 2000);
  assert.ok(gps.acceleration < 0);
});
test('coordinate fallback calculates distance, and suppresses stationary jitter', () => {
  const gps = new GPSMotion();
  assert.equal(gps.ingest(fix(null), base).reason, 'warming');
  assert.equal(gps.ingest(fix(null, 1, { latitude: 43.650001 }), base + 1000).ok, true);
  assert.equal(gps.speed, 0);
  gps.ingest(fix(null, 3, { latitude: 43.65018 }), base + 3000);
  assert.equal(gps.method, 'estimated');
  assert.ok(gps.speed > 8 && gps.speed < 11);
  assert.ok(Math.abs(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0.001, longitude: 0 }) - 111.195) < 0.1);
});
test('bad accuracy, stale fixes, duplicate timestamps, and speed spikes are rejected', () => {
  const gps = new GPSMotion();
  assert.equal(gps.ingest(fix(5, 0, { accuracy: 61 }), base).reason, 'accuracy');
  assert.equal(gps.ingest(fix(5), base + 9000).reason, 'stale');
  assert.equal(gps.ingest(fix(100), base).reason, 'jump');
  gps.ingest(fix(5), base);
  assert.equal(gps.ingest(fix(5), base).reason, 'duplicate');
  assert.equal(gps.ingest(fix(60, 1), base + 1000).reason, 'jump');
  assert.equal(gps.ingest(fix(6, 2), base + 2000).ok, true);
  assert.ok(gps.speed < 7);
});
test('native GPS stationary noise is filtered; expiry/reset remove motion', () => {
  const gps = new GPSMotion();
  gps.ingest(fix(0.4), base);
  assert.equal(gps.speed, 0);
  assert.equal(gps.fresh(base + 8000), true);
  assert.equal(gps.fresh(base + 8001), false);
  gps.reset(); assert.equal(gps.fresh(base), false); assert.equal(gps.previous, null);
});
test('GPS engine has a continuous monotonic RPM curve with acceleration load', () => {
  const preset = PRESETS.muscle;
  let previous = preset.idle;
  for (let kmh = 0; kmh <= 240; kmh += 0.5) {
    const motion = gpsEngine(kmh / 3.6, 0, preset);
    assert.ok(motion.rpm >= previous); assert.ok(motion.rpm - previous <= 12.01); previous = motion.rpm;
  }
  assert.ok(gpsEngine(20, 2, preset).rpm > gpsEngine(20, 0, preset).rpm);
  assert.ok(gpsEngine(20, 2, preset).load > gpsEngine(20, 0, preset).load);
  assert.ok(gpsEngine(1000, 20, preset).rpm <= preset.redline + 150);
});
test('parked drive accelerates, shifts automatically, coasts, and stops with brake', () => {
  const pedals = new PedalMotion();
  run(pedals, 12); assert.ok(pedals.speed > 20); assert.ok(pedals.gear >= 2);
  const fast = pedals.speed;
  run(pedals, 2, 0); assert.ok(pedals.speed < fast);
  run(pedals, 10, 0, 1); assert.equal(pedals.speed, 0);
});
test('brake wins over throttle and stalled frames are bounded', () => {
  const pedals = new PedalMotion(); run(pedals, 3); const before = pedals.speed;
  run(pedals, 1, 1, 1); assert.ok(pedals.speed < before);
  const fresh = new PedalMotion(); fresh.step(100, 1, 0, true, PRESETS.muscle); assert.ok(fresh.speed < 1);
});
test('neutral reaches each limiter without moving, releases to idle, then shuts off', () => {
  for (const preset of Object.values(PRESETS)) {
    const pedals = new PedalMotion(); pedals.neutral = true;
    run(pedals, 3, 1, 0, preset); assert.equal(pedals.speed, 0); assert.ok(pedals.rpm >= preset.redline); assert.ok(pedals.rpm <= preset.redline + 150);
    run(pedals, 4, 0, 0, preset); assert.ok(Math.abs(pedals.rpm - preset.idle) < 2);
    assert.equal(pedals.step(0.1, 1, 0, false, preset).rpm, 0);
  }
});
