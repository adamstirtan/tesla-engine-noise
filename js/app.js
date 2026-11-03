import { PRESETS, GPSMotion, PedalMotion, gpsEngine, clamp } from './physics.js';
import { EngineAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const gps = new GPSMotion(), pedals = new PedalMotion(), audio = new EngineAudio();
let saved = {};
try { saved = JSON.parse(localStorage.getItem('drive-tone-preferences') || '{}') || {}; } catch { /* Storage may be disabled. */ }
const state = { mode: 'gps', preset: Object.prototype.hasOwnProperty.call(PRESETS, saved.preset) ? saved.preset : 'muscle', volume: Number.isFinite(saved.volume) ? clamp(saved.volume, 0, 1) : 0.4, pops: typeof saved.pops === 'boolean' ? saved.pops : true, running: false, pending: false, rpm: 0, load: 0, watch: null, operation: 0, gpsSession: 0, gpsUsable: false, gpsStatus: 'standby' };
const held = { throttle: new Set(), brake: new Set() };
let frameTime = performance.now(), displayedAt = 0;
function save() { try { localStorage.setItem('drive-tone-preferences', JSON.stringify({ preset: state.preset, volume: state.volume, pops: state.pops })); } catch { /* Best effort. */ } }
function notice(text, error = false) { $('notice-text').textContent = text; $('notice').classList.toggle('error', error); }
function releasePedals() { held.throttle.clear(); held.brake.clear(); $('throttle').classList.remove('pressed'); $('brake').classList.remove('pressed'); }
function badge(label, className = '') { $('gps-label').textContent = label; $('gps-badge').className = `gps-badge ${className}`; }

const svgNS = 'http://www.w3.org/2000/svg';
function svgElement(tag, attrs, text) { const element = document.createElementNS(svgNS, tag); for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value); if (text !== undefined) element.textContent = text; return element; }
function point(speed, radius) { const angle = (150 + clamp(speed, 0, 240)) * Math.PI / 180; return [300 + radius * Math.cos(angle), 242 + radius * Math.sin(angle)]; }
function arc(start, end, radius) { const a = point(start, radius), b = point(end, radius); return `M ${a[0]} ${a[1]} A ${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${b[0]} ${b[1]}`; }
const art = $('gauge-art');
art.append(svgElement('path', { d: arc(0, 240, 210), fill: 'none', stroke: '#2b2c2d', 'stroke-width': 1 }));
art.append(svgElement('path', { d: arc(0, 240, 190), fill: 'none', stroke: '#292a2b', 'stroke-width': 3 }));
art.append(svgElement('path', { d: arc(180, 240, 190), fill: 'none', stroke: '#814535', 'stroke-width': 3 }));
for (let speed = 0; speed <= 240; speed += 5) {
  const major = speed % 20 === 0, medium = speed % 10 === 0;
  const a = point(speed, 186), b = point(speed, major ? 170 : medium ? 176 : 180);
  art.append(svgElement('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: speed >= 180 ? '#d76f51' : major ? '#dad5cb' : '#777873', 'stroke-width': major ? 2 : 1 }));
  if (major) { const p = point(speed, 149); art.append(svgElement('text', { x: p[0], y: p[1] + 5, 'text-anchor': 'middle', fill: speed >= 180 ? '#d8876d' : '#b9b8b2', 'font-family': 'Arial, sans-serif', 'font-size': 15 }, speed)); }
}
const icons = [
  '<path d="M4 9h4l2-3h6l3 3h2v9h-5l-3 2H7l-3-3V9Z"/><path d="M3 6v9M1 10h3m7-7h6m-3 0v3m-5 6h7m-4-3v6"/>',
  '<path d="M8 8h8v8H8zM3 5h5v5H3zM16 5h5v5h-5zM3 14h5v5H3zM16 14h5v5h-5zM12 3v5m0 8v5"/>',
  '<path d="m4 5 8 7 8-7M4 19l8-7 8 7M4 5v14m16-14v14M8 3l4 4 4-4M8 21l4-4 4 4"/>',
];
Object.entries(PRESETS).forEach(([key, preset], index) => {
  const button = document.createElement('button'); button.className = 'engine-option'; button.dataset.preset = key; button.setAttribute('aria-pressed', 'false');
  button.innerHTML = `<span class="engine-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[index]}</svg></span><span><span class="engine-name">${preset.name}</span><span class="engine-detail">${preset.detail}</span></span><span class="engine-radio" aria-hidden="true"></span>`;
  button.addEventListener('click', () => chooseEngine(key)); $('engine-options').append(button);
});
function updateEngineSelection() {
  for (const button of $('engine-options').children) { const selected = button.dataset.preset === state.preset; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); }
  $('redline').textContent = PRESETS[state.preset].redline.toLocaleString('en-CA');
  const maximum = Math.ceil(PRESETS[state.preset].redline / 1000);
  document.querySelector('.rpm-track').style.setProperty('--rpm-step', `${100 / maximum}%`);
  document.querySelector('.rpm-scale').replaceChildren(...Array.from({ length: maximum + 1 }, (_, index) => { const label = document.createElement('span'); label.textContent = index === maximum ? `${maximum} × 1,000` : String(index); return label; }));
}
function sourceLabel() { $('sound-source').textContent = audio.source ? audio.kind === 'recording' ? 'CC0 recording · pitch follows engine RPM' : 'Synthesized preview · recording unavailable' : 'Audio ready on start · CC0 recording or synth preview'; }
async function chooseEngine(key) {
  if (state.preset === key) return;
  state.preset = key; updateEngineSelection(); save();
  if (state.pending) { stopEngine(); sourceLabel(); return; }
  if (state.running) {
    const operation = ++state.operation;
    try { const result = await audio.select(PRESETS[key]); if (operation === state.operation && result) sourceLabel(); }
    catch (error) { if (operation === state.operation) { stopEngine(); notice(error.message, true); } }
  } else sourceLabel();
}
function stopGPS() {
  state.gpsSession++;
  if (state.watch !== null && navigator.geolocation) navigator.geolocation.clearWatch(state.watch);
  state.watch = null; state.gpsUsable = false; state.gpsStatus = 'standby'; gps.reset(); $('retry-gps').hidden = true;
  badge(state.mode === 'manual' ? 'SIMULATED' : 'GPS STANDBY');
}
function startGPS() {
  stopGPS();
  if (state.mode !== 'gps') return;
  if (!window.isSecureContext) { state.gpsStatus = 'error'; badge('HTTPS REQUIRED', 'error'); notice('Location requires HTTPS. Open the GitHub Pages URL, or use localhost for development.', true); return; }
  if (!navigator.geolocation) { state.gpsStatus = 'error'; badge('GPS UNAVAILABLE', 'error'); notice('This browser does not expose location. Pedal playground is available while parked.', true); return; }
  state.gpsStatus = 'searching'; badge('FINDING GPS'); notice('Allow location access when prompted. Waiting for a reliable GPS fix…');
  const session = state.gpsSession;
  state.watch = navigator.geolocation.watchPosition((position) => {
    if (session !== state.gpsSession || state.mode !== 'gps') return;
    const result = gps.ingest(position);
    if (result.reason === 'duplicate') return;
    state.gpsUsable = result.ok;
    if (result.ok) {
      state.gpsStatus = 'connected'; badge(result.method === 'native' ? 'GPS CONNECTED' : 'GPS ESTIMATED', 'connected'); $('retry-gps').hidden = true;
      notice(result.method === 'native' ? 'GPS connected. Speed and acceleration shape the engine sound. Location stays on this device.' : 'GPS connected. Speed is estimated from consecutive locations; short movements may be filtered out.');
    } else {
      state.gpsStatus = 'weak'; badge('GPS UNRELIABLE', 'error');
      const messages = { accuracy: 'GPS accuracy is too low. Holding the engine at idle until the signal improves.', jump: 'An unexpected GPS jump was filtered out. Waiting for the next reliable fix.', stale: 'The browser returned an old GPS fix. Waiting for a fresh location.', warming: 'Location found. Waiting for another fix to estimate speed.' };
      notice(messages[result.reason] || 'Waiting for a reliable GPS fix.', result.reason !== 'warming');
    }
  }, (error) => {
    if (session !== state.gpsSession || state.mode !== 'gps') return;
    state.gpsUsable = false; state.gpsStatus = 'error'; badge(error.code === 1 ? 'GPS DENIED' : 'GPS LOST', 'error'); $('retry-gps').hidden = false;
    notice(error.code === 1 ? 'Location access was denied. Allow it in the browser settings, then retry GPS. Pedal playground is available while parked.' : 'GPS is unavailable or timed out. The engine returns to idle. Retry GPS when the signal improves.', true);
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
}
function setMode(mode) {
  if (state.mode === mode) return;
  releasePedals(); stopGPS(); pedals.reset(); state.mode = mode; state.rpm = state.running ? PRESETS[state.preset].idle : 0; state.load = 0;
  for (const name of ['gps', 'manual']) { const button = $(`${name}-mode`); button.classList.toggle('selected', mode === name); button.setAttribute('aria-pressed', String(mode === name)); }
  $('pedal-controls').hidden = mode !== 'manual'; $('speed-caption').textContent = mode === 'manual' ? 'SIMULATED SPEED' : 'LIVE SPEED';
  $('ignition-hint').textContent = mode === 'manual' ? 'Hold the pedals. Let the good times roll.' : 'Tap to unlock audio & connect GPS.';
  setNeutral(false);
  if (mode === 'gps' && state.running) startGPS();
  else { badge(mode === 'manual' ? 'SIMULATED' : 'GPS STANDBY'); notice(mode === 'manual' ? 'Parked playground. Speed is simulated. Hold throttle to accelerate, brake to slow down, or select Free rev to rev in neutral.' : 'Start the engine to connect GPS. Speed and acceleration will shape the soundtrack.'); }
}
function setNeutral(neutral) {
  releasePedals(); pedals.neutral = neutral; pedals.speed = 0; pedals.acceleration = 0; pedals.gear = 1;
  for (const [id, active] of [['drive-gear', !neutral], ['neutral-gear', neutral]]) { $(id).classList.toggle('selected', active); $(id).setAttribute('aria-pressed', String(active)); }
  $('shift-description').textContent = neutral ? 'Neutral: rev the engine without simulated movement.' : 'Automatic shifts in this mode.';
}
function engineButtons() { $('ignition').disabled = state.pending; $('ignition').classList.toggle('running', state.running); $('ignition-label').textContent = state.pending ? 'WAKING THE ENGINE…' : state.running ? 'STOP ENGINE' : 'START ENGINE'; $('engine-dot').classList.toggle('running', state.running); $('engine-status').textContent = state.pending ? 'STARTING' : state.running ? 'ENGINE RUNNING' : 'ENGINE OFF'; }
function stopEngine() {
  ++state.operation; state.running = false; state.pending = false; state.rpm = 0; state.load = 0; audio.stop(); releasePedals(); pedals.reset(); setNeutral(false); stopGPS(); engineButtons(); sourceLabel();
}
async function ignite() {
  if (state.running) { stopEngine(); notice('Engine off. Tap Start whenever you want your soundtrack back.'); return; }
  const operation = ++state.operation; state.pending = true; engineButtons();
  try {
    // Called directly from a click to satisfy browser audio policies.
    await audio.unlock();
    if (operation !== state.operation) return;
    const kind = await audio.select(PRESETS[state.preset]);
    if (operation !== state.operation || !kind) return;
    state.pending = false; state.running = true; state.rpm = PRESETS[state.preset].idle; engineButtons(); sourceLabel();
    if (state.mode === 'gps') startGPS();
    else notice(kind === 'recording' ? 'Engine running. Hold the pedals, or select Free rev for a stationary throttle blip.' : 'Engine running with a synthesized preview. The licensed recording is not installed yet. Hold throttle to try it.');
  } catch (error) { if (operation === state.operation) { stopEngine(); notice(`Could not start audio: ${error.message}`, true); } }
}
function volumeUI() { $('volume').value = Math.round(state.volume * 100); $('volume-value').value = `${Math.round(state.volume * 100)}%`; $('volume').style.background = `linear-gradient(to right,var(--orange) ${state.volume * 100}%,#363738 ${state.volume * 100}%)`; }
$('gps-mode').addEventListener('click', () => setMode('gps')); $('manual-mode').addEventListener('click', () => setMode('manual'));
$('drive-gear').addEventListener('click', () => setNeutral(false)); $('neutral-gear').addEventListener('click', () => setNeutral(true));
$('reset').addEventListener('click', () => { const neutral = pedals.neutral; pedals.reset(); setNeutral(neutral); notice('Playground reset. Ready for another run.'); });
$('ignition').addEventListener('click', ignite); $('retry-gps').addEventListener('click', startGPS);
$('volume').addEventListener('input', (event) => { state.volume = Number(event.target.value) / 100; volumeUI(); save(); });
$('pops').checked = state.pops; $('pops').addEventListener('change', (event) => { state.pops = event.target.checked; save(); });
for (const name of ['throttle', 'brake']) {
  const button = $(name);
  button.addEventListener('pointerdown', (event) => {
    if (!state.running) { notice('Start the engine first, then press and hold a pedal.'); return; }
    event.preventDefault(); button.setPointerCapture(event.pointerId); held[name].add(event.pointerId); button.classList.add('pressed');
  });
  const release = (event) => { held[name].delete(event.pointerId); button.classList.toggle('pressed', held[name].size > 0); };
  button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
}
function keyboardPedal(event) { if (['ArrowUp', 'w', 'W'].includes(event.key)) return 'throttle'; if (['ArrowDown', 's', 'S'].includes(event.key)) return 'brake'; return null; }
window.addEventListener('keydown', (event) => {
  const pedal = keyboardPedal(event);
  if (!pedal || state.mode !== 'manual' || !state.running || $('credits-dialog').open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  event.preventDefault(); held[pedal].add(event.code); $(pedal).classList.add('pressed');
});
window.addEventListener('keyup', (event) => { const pedal = keyboardPedal(event); if (!pedal) return; held[pedal].delete(event.code); $(pedal).classList.toggle('pressed', held[pedal].size > 0); });
window.addEventListener('blur', releasePedals);
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopEngine(); notice('Audio stopped while the browser was hidden. Tap Start to resume.'); } });
window.addEventListener('pagehide', stopEngine);
$('credits-button').addEventListener('click', () => { releasePedals(); $('credits-dialog').showModal(); }); $('close-credits').addEventListener('click', () => $('credits-dialog').close());
$('credits-dialog').addEventListener('click', (event) => { if (event.target === $('credits-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
$('fullscreen').hidden = !document.documentElement.requestFullscreen;
$('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { notice('Full screen is unavailable in this browser.'); } });
document.addEventListener('fullscreenchange', () => { $('fullscreen').textContent = document.fullscreenElement ? 'Exit full screen ⛶' : 'Full screen ⛶'; });
function render(speed, acceleration, usable) {
  const kmh = Math.max(0, speed * 3.6);
  $('speed').textContent = state.mode === 'gps' && !usable && state.gpsStatus !== 'standby' ? '—' : String(Math.round(kmh));
  $('needle').style.transform = `rotate(${clamp(kmh, 0, 240)}deg)`;
  $('speed-trail').setAttribute('d', kmh > 0.1 ? arc(0, clamp(kmh, 0, 240), 190) : '');
  const preset = PRESETS[state.preset];
  $('rpm').textContent = (Math.round(state.rpm / 10) * 10).toLocaleString('en-CA');
  const maxRPM = Math.ceil(preset.redline / 1000) * 1000;
  $('rpm-fill').style.width = `${clamp(state.rpm / maxRPM * 100, 0, 100)}%`;
  $('rpm-fill').style.background = state.rpm >= preset.redline - 35 ? '#e34935' : 'var(--orange)';
  document.querySelector('.rpm-redzone').style.width = `${(1 - preset.redline / maxRPM) * 100}%`;
  $('acceleration').textContent = `${acceleration < -0.05 ? '−' : '+'}${Math.abs(acceleration).toFixed(1)}`;
  $('accel-description').textContent = state.mode === 'manual' ? 'Simulated motion' : usable ? acceleration > 0.3 ? 'Picking up speed' : acceleration < -0.3 ? 'Rolling off the throttle' : 'Steady as she goes' : 'Waiting for location';
  $('load').textContent = String(Math.round(state.load * 100)); $('load-fill').style.width = `${state.load * 100}%`;
  $('accuracy').textContent = state.mode === 'gps' && gps.accuracy !== null ? Math.round(gps.accuracy) : '—'; $('accuracy-unit').textContent = state.mode === 'manual' ? '' : 'm';
  $('signal-description').textContent = state.mode === 'manual' ? 'No GPS needed' : usable ? gps.method === 'estimated' ? 'Position-derived speed' : 'Live GPS speed' : 'On-device GPS only';
  $('gear').textContent = state.mode === 'gps' ? 'DIRECT' : pedals.neutral ? 'N' : `D${pedals.gear}`;
  $('drive-state').textContent = !state.running ? 'READY WHEN YOU ARE' : state.rpm >= preset.redline - 35 ? 'REV LIMITER' : state.mode === 'gps' && !usable ? 'WAITING FOR GPS' : state.mode === 'manual' && pedals.neutral ? 'FREE REV' : kmh < 1 ? 'IDLING' : 'LET IT RUMBLE';
  $('speedometer').setAttribute('aria-label', `${state.mode === 'manual' ? 'Simulated' : 'GPS'} speed ${state.mode === 'gps' && !usable ? 'unavailable' : `${Math.round(kmh)} kilometres per hour`}`);
}
function frame(now) {
  const dt = clamp((now - frameTime) / 1000, 0, 0.1); frameTime = now;
  const preset = PRESETS[state.preset], usable = state.gpsUsable && gps.fresh();
  if (state.mode === 'gps' && state.gpsUsable && !usable) {
    state.gpsUsable = false; state.gpsStatus = 'stale'; badge('GPS LOST', 'error'); $('retry-gps').hidden = false;
    notice('GPS updates stopped. Speed is unavailable and the engine returns to idle until a fresh fix arrives.', true);
  }
  if (state.running && audio.context?.state !== 'running') { stopEngine(); notice('The browser paused audio. Tap Start to resume the engine.', true); }
  let speed = 0, acceleration = 0;
  if (state.mode === 'manual') {
    const motion = pedals.step(dt, held.throttle.size ? 1 : 0, held.brake.size ? 1 : 0, state.running, preset);
    speed = pedals.speed; acceleration = pedals.acceleration; state.rpm = motion.rpm; state.load = motion.load;
  } else {
    speed = usable ? gps.speed : 0; acceleration = usable ? gps.acceleration : 0;
    const motion = gpsEngine(speed, acceleration, preset), targetRPM = state.running ? usable ? motion.rpm : preset.idle : 0;
    state.rpm += (targetRPM - state.rpm) * (1 - Math.exp(-dt / 0.24)); state.load = state.running ? usable ? motion.load : 0.08 : 0;
  }
  if (state.running) audio.update(state.rpm, state.load, preset, state.volume, state.pops, acceleration);
  if (now - displayedAt > 70) { render(speed, acceleration, usable); displayedAt = now; }
  requestAnimationFrame(frame);
}
updateEngineSelection(); volumeUI(); sourceLabel(); render(0, 0, false); requestAnimationFrame(frame);
