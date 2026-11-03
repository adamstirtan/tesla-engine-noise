import { clamp } from './physics.js';

export class EngineAudio {
  constructor() { this.context = null; this.source = null; this.cache = new Map(); this.serial = 0; this.lastPop = 0; this.previousLoad = 0; this.previousRpm = 0; this.kind = 'synth'; }
  async unlock() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('Web Audio is unavailable in this browser.');
    if (!this.context) {
      const c = this.context = new AudioContext();
      this.master = c.createGain(); this.master.gain.value = 0;
      const compressor = c.createDynamicsCompressor();
      compressor.threshold.value = -12; compressor.knee.value = 15; compressor.ratio.value = 5;
      this.master.connect(compressor); compressor.connect(c.destination);
      this.noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.23), c.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.04));
    }
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Audio is paused by the browser. Tap Start again.');
  }
  async load(preset) {
    const key = preset.file;
    if (this.cache.has(key)) return this.cache.get(key);
    let result;
    try {
      const response = await fetch(new URL(`../audio/${key}`, import.meta.url), { signal: globalThis.AbortSignal?.timeout ? AbortSignal.timeout(10000) : undefined });
      if (!response.ok) throw new Error('Recording not installed');
      const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      result = { buffer: this.makeLoop(buffer), kind: 'recording' };
    } catch {
      result = { buffer: this.synthesize(preset), kind: 'synth' };
    }
    this.cache.set(key, result);
    return result;
  }
  makeLoop(original) {
    // Find a steady four-second section, then overlap the seam for click-free looping.
    const duration = Math.min(4, original.duration * 0.8);
    const length = Math.floor(duration * original.sampleRate);
    const mono = original.getChannelData(0);
    let start = Math.floor(Math.min(1, original.duration * 0.1) * original.sampleRate);
    let best = Infinity;
    for (let offset = start; offset + length < original.length; offset += Math.floor(original.sampleRate / 2)) {
      const energies = [];
      for (let block = 0; block < 8; block++) {
        let energy = 0;
        for (let i = offset + Math.floor(block * length / 8); i < offset + Math.floor((block + 1) * length / 8); i += 32) energy += mono[i] ** 2;
        energies.push(energy);
      }
      const mean = energies.reduce((a, b) => a + b, 0) / 8;
      const variation = energies.reduce((sum, e) => sum + (e - mean) ** 2, 0) / (mean ** 2 + 1e-8);
      if (mean > 0.0001 && variation < best) { best = variation; start = offset; }
    }
    const fade = Math.min(Math.floor(original.sampleRate * 0.05), Math.floor(length / 4));
    const loop = this.context.createBuffer(original.numberOfChannels, length - fade, original.sampleRate);
    for (let channel = 0; channel < loop.numberOfChannels; channel++) {
      const input = original.getChannelData(channel), output = loop.getChannelData(channel);
      output.set(input.subarray(start + fade, start + length));
      for (let i = 0; i < fade; i++) {
        const blend = i / fade;
        output[output.length - fade + i] = input[start + length - fade + i] * (1 - blend) + input[start + i] * blend;
      }
    }
    let peak = 0;
    for (let channel = 0; channel < loop.numberOfChannels; channel++) for (const sample of loop.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
    const gain = peak > 0 ? 0.75 / peak : 1;
    for (let channel = 0; channel < loop.numberOfChannels; channel++) { const data = loop.getChannelData(channel); for (let i = 0; i < data.length; i++) data[i] *= gain; }
    return loop;
  }
  synthesize(preset) {
    const c = this.context;
    // A periodic combustion waveform with different firing rhythms and harmonics.
    const frames = Math.round(c.sampleRate * 120 / preset.idle);
    const buffer = c.createBuffer(1, frames, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      const phase = i / frames;
      let sample = 0;
      for (let cylinder = 0; cylinder < preset.cylinders; cylinder++) {
        const irregularity = preset.tone < 1 ? (cylinder % 2) * 0.018 : 0;
        const t = (phase - cylinder / preset.cylinders - irregularity + 1) % 1;
        sample += Math.exp(-t * 70) * Math.sin(t * Math.PI * 2 * (20 * preset.tone)) * (cylinder % 2 ? 0.65 : 1);
      }
      sample += 0.18 * Math.sin(phase * Math.PI * 2 * preset.cylinders);
      data[i] = Math.tanh(sample * 1.5) * 0.65;
    }
    return buffer;
  }
  async select(preset) {
    const serial = ++this.serial;
    const loaded = await this.load(preset);
    if (serial !== this.serial) return null;
    this.stopSource();
    const c = this.context;
    this.source = c.createBufferSource(); this.source.buffer = loaded.buffer; this.source.loop = true;
    this.filter = c.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.Q.value = 0.6;
    this.voice = c.createGain(); this.voice.gain.value = 0;
    this.source.connect(this.filter); this.filter.connect(this.voice); this.voice.connect(this.master);
    this.source.start(); this.kind = loaded.kind;
    this.previousLoad = 0; this.previousRpm = 0;
    return loaded.kind;
  }
  stopSource() {
    if (!this.source) return;
    const source = this.source, filter = this.filter, voice = this.voice;
    const now = this.context.currentTime;
    voice.gain.cancelScheduledValues(now); voice.gain.setTargetAtTime(0, now, 0.015);
    source.stop(now + 0.08);
    source.onended = () => { source.disconnect(); filter.disconnect(); voice.disconnect(); };
    this.source = null;
  }
  stop() {
    this.serial++;
    if (this.context) this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.015);
    this.stopSource(); this.previousLoad = 0; this.previousRpm = 0;
  }
  update(rpm, load, preset, volume, pops, acceleration = 0) {
    if (!this.source || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const revs = clamp((rpm - preset.idle) / (preset.redline - preset.idle), 0, 1);
    const rate = this.kind === 'recording' ? 0.85 + revs * 2.85 : clamp(rpm / preset.idle, 0.8, 12);
    this.source.playbackRate.setTargetAtTime(rate, now, 0.07);
    this.filter.frequency.setTargetAtTime((650 + revs * 2900 + load * 1900) * preset.tone, now, 0.06);
    const limited = rpm >= preset.redline - 35;
    const cut = limited && Math.sin(now * Math.PI * 2 * 14) > 0 ? 0.12 : 1;
    this.voice.gain.setTargetAtTime((0.22 + load * 0.53 + revs * 0.12) * cut, now, limited ? 0.002 : 0.045);
    this.master.gain.setTargetAtTime(volume * 0.8, now, 0.04);
    if (pops && this.previousRpm > preset.idle + 700 && now - this.lastPop > 0.65 && (this.previousLoad - load > 0.3 || (acceleration < -0.8 && revs > 0.15))) {
      this.pop(now); if (revs > 0.45) this.pop(now + 0.09); this.lastPop = now;
    }
    this.previousLoad = load; this.previousRpm = rpm;
  }
  pop(when) {
    const c = this.context;
    const noise = c.createBufferSource(); noise.buffer = this.noise;
    const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1800;
    const gain = c.createGain(); gain.gain.setValueAtTime(0.28, when); gain.gain.exponentialRampToValueAtTime(0.001, when + 0.19);
    noise.connect(filter); filter.connect(gain); gain.connect(this.master); noise.start(when); noise.stop(when + 0.23);
    noise.onended = () => { noise.disconnect(); filter.disconnect(); gain.disconnect(); };
    const boom = c.createOscillator(), envelope = c.createGain(); boom.frequency.setValueAtTime(120, when); boom.frequency.exponentialRampToValueAtTime(35, when + 0.13); envelope.gain.setValueAtTime(0.18, when); envelope.gain.exponentialRampToValueAtTime(0.001, when + 0.15);
    boom.connect(envelope); envelope.connect(this.master); boom.start(when); boom.stop(when + 0.16); boom.onended = () => { boom.disconnect(); envelope.disconnect(); };
  }
}
