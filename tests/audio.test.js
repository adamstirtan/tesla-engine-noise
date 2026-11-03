import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineAudio } from '../js/audio.js';
import { PRESETS } from '../js/physics.js';

function context(sampleRate = 44100) {
  return { sampleRate, createBuffer(channels, length, rate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, duration: length / rate, sampleRate: rate, numberOfChannels: channels, getChannelData: channel => data[channel] };
  } };
}

test('each fallback produces distinct, finite, bounded, non-silent PCM audio', () => {
  const audio = new EngineAudio(); audio.context = context();
  const signatures = [];
  for (const preset of Object.values(PRESETS)) {
    const buffer = audio.synthesize(preset), data = buffer.getChannelData(0);
    let power = 0, peak = 0;
    for (const value of data) { assert.ok(Number.isFinite(value)); power += value ** 2; peak = Math.max(peak, Math.abs(value)); }
    assert.ok(Math.sqrt(power / data.length) > 0.1);
    assert.ok(peak <= 0.66);
    assert.ok(Math.abs(data[0] - data[data.length - 1]) < 0.03, 'Loop boundary avoids a hard click');
    signatures.push([data.length, data[100]].join(':'));
  }
  assert.equal(new Set(signatures).size, 3);
});
test('recording loops retain stereo, normalize loudness, and join continuously', () => {
  const audio = new EngineAudio(); audio.context = context(8000);
  const input = audio.context.createBuffer(2, 8000 * 7, 8000);
  for (let channel = 0; channel < 2; channel++) {
    const data = input.getChannelData(channel);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * Math.PI * 2 * 100 / 8000) * (channel ? 0.4 : 0.8);
  }
  const loop = audio.makeLoop(input);
  assert.equal(loop.numberOfChannels, 2);
  assert.ok(loop.duration > 3 && loop.duration < 4);
  for (let channel = 0; channel < 2; channel++) {
    const data = loop.getChannelData(channel);
    assert.ok(Math.abs(data[0] - data[data.length - 1]) < 0.07);
    for (const value of data) { assert.ok(Number.isFinite(value)); assert.ok(Math.abs(value) <= 0.7501); }
  }
});
