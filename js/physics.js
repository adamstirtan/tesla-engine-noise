export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const PRESETS = {
  muscle: { name: 'American muscle', detail: 'V8 / LOW, LOUD & UNAPOLOGETIC', idle: 750, redline: 6500, cylinders: 8, tone: 0.72, file: 'muscle.mp3' },
  'flat-six': { name: 'Air-cooled six', detail: 'FLAT SIX / RAW MECHANICAL SOUL', idle: 850, redline: 7200, cylinders: 6, tone: 1, file: 'flat-six.mp3' },
  exotic: { name: 'Italian exotic', detail: 'HIGH REV / SHARP & EXPRESSIVE', idle: 1000, redline: 8500, cylinders: 8, tone: 1.35, file: 'exotic.mp3' },
};

export function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * rad;
  const lon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

// Coordinates are transient and never leave this object/browser.
export class GPSMotion {
  constructor() { this.reset(); }
  reset() { this.previous = null; this.speed = 0; this.acceleration = 0; this.accuracy = null; this.lastFix = 0; this.method = null; }
  ingest(position, now = Date.now()) {
    const c = position.coords;
    const timestamp = position.timestamp;
    if (!Number.isFinite(timestamp) || now - timestamp > 8000 || timestamp > now + 2000) return { ok: false, reason: 'stale' };
    if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) || !Number.isFinite(c.accuracy) || c.accuracy < 0 || c.accuracy > 60) return { ok: false, reason: 'accuracy' };
    const previous = this.previous;
    if (previous && timestamp <= previous.timestamp) return { ok: false, reason: 'duplicate' };
    const dt = previous ? (timestamp - previous.timestamp) / 1000 : 0;
    let raw = Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null;
    let method = 'native';
    if (raw === null) {
      method = 'estimated';
      if (previous && dt >= 0.2 && dt <= 10) {
        const distance = distanceMeters(previous.coords, c);
        const uncertainty = Math.max(4, (previous.coords.accuracy + c.accuracy) * 0.225);
        raw = distance < uncertainty ? 0 : distance / dt;
      }
    }
    if (raw !== null && (raw > 90 || (previous && dt > 0 && dt < 10 && Math.abs(raw - previous.raw) / dt > 12))) {
      // Rebase after a jump so the next real fix can recover, but invalidate motion.
      this.previous = { coords: c, timestamp, raw: this.speed };
      return { ok: false, reason: 'jump' };
    }
    this.previous = { coords: c, timestamp, raw: raw ?? 0 };
    this.accuracy = c.accuracy;
    if (raw === null) return { ok: false, reason: 'warming' };
    raw = raw < 0.65 ? 0 : raw;
    const before = this.speed;
    const continuous = this.lastFix && dt > 0 && dt <= 8;
    const blend = continuous ? 1 - Math.exp(-dt / 0.65) : 1;
    this.speed += (raw - this.speed) * blend;
    if (raw === 0 && this.speed < 0.65) this.speed = 0;
    const acceleration = continuous ? clamp((this.speed - before) / dt, -8, 8) : 0;
    this.acceleration = continuous ? this.acceleration + (acceleration - this.acceleration) * 0.65 : 0;
    this.lastFix = timestamp;
    this.method = method;
    return { ok: true, method };
  }
  fresh(now = Date.now()) { return this.lastFix > 0 && now - this.lastFix <= 8000; }
}

export function gpsEngine(speed, acceleration, preset) {
  const kmh = speed * 3.6;
  const load = clamp(0.08 + kmh / 550 + Math.max(0, acceleration) / 4, 0.05, 1);
  // One continuous RPM curve: deliberately no pretend shifts in GPS mode.
  const rpm = clamp(preset.idle + kmh * 24 + Math.max(0, acceleration) * 380, preset.idle, preset.redline + 100);
  return { rpm, load };
}

export class PedalMotion {
  constructor() { this.reset(); }
  reset() { this.speed = 0; this.acceleration = 0; this.rpm = 0; this.gear = 1; this.neutral = false; this.shiftTimer = 0; this.shiftCut = 0; }
  step(dt, throttle, brake, running, preset) {
    dt = clamp(dt, 0, 0.1);
    if (!running) { this.speed = 0; this.acceleration = 0; this.rpm = 0; return { rpm: 0, load: 0 }; }
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    this.shiftCut = Math.max(0, this.shiftCut - dt);
    let effectiveThrottle = brake ? 0 : throttle;
    const before = this.speed;
    if (this.neutral) this.speed = 0;
    else this.speed = clamp(this.speed + (effectiveThrottle * (5.8 / (1 + this.speed / 48)) - 0.35 - this.speed * 0.018 - brake * 10) * dt, 0, 85);
    this.acceleration = dt > 0 ? (this.speed - before) / dt : 0;
    const ratios = [92, 65, 46, 34, 26, 22];
    let target = this.neutral ? preset.idle + effectiveThrottle * (preset.redline - preset.idle + 250) : preset.idle + this.speed * 3.6 * ratios[this.gear - 1] + effectiveThrottle * 500;
    if (!this.neutral && !this.shiftTimer) {
      if (target > preset.redline * 0.88 && this.gear < 6) { this.gear++; this.shiftTimer = 0.7; this.shiftCut = 0.16; }
      else if (target < preset.redline * 0.28 && this.gear > 1) { this.gear--; this.shiftTimer = 0.7; }
      target = preset.idle + this.speed * 3.6 * ratios[this.gear - 1] + effectiveThrottle * 500;
    }
    this.rpm += (clamp(target, preset.idle, preset.redline + 150) - this.rpm) * (1 - Math.exp(-dt / (effectiveThrottle ? 0.2 : 0.45)));
    return { rpm: this.rpm, load: clamp(0.08 + effectiveThrottle * 0.92 - (this.shiftCut ? 0.75 : 0), 0.05, 1) };
  }
}
