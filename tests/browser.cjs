/* Optional browser integration checks: npm install --no-save playwright
 * npx playwright install chromium; start the local server; node tests/browser.cjs
 * Not executed in the authoring environment: browser execution was approval-blocked.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      window.testGPS = { success: null, failure: null, cleared: 0 };
      Object.defineProperty(navigator, 'geolocation', { value: {
        watchPosition(success, failure) { window.testGPS.success = success; window.testGPS.failure = failure; return 1; },
        clearWatch() { window.testGPS.cleared++; window.testGPS.success = null; },
      } });
      const Original = window.AudioContext;
      window.AudioContext = class extends Original {
        constructor(...args) { super(...args); window.testAudioContext = this; }
        createDynamicsCompressor() {
          const compressor = super.createDynamicsCompressor();
          window.testAnalyser = this.createAnalyser(); compressor.connect(window.testAnalyser);
          return compressor;
        }
      };
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(process.env.TEST_URL || 'http://localhost:5173/');
    await page.locator('#ignition').click();
    await page.waitForFunction(() => document.getElementById('engine-status').textContent === 'ENGINE RUNNING');
    await page.evaluate(() => testGPS.success({ timestamp: Date.now(), coords: { latitude: 43.65, longitude: -79.38, accuracy: 5, speed: 20 } }));
    await page.waitForFunction(() => document.getElementById('speed').textContent === '72');
    assert.equal(await page.locator('#gear').textContent(), 'DIRECT');
    assert.ok(await page.evaluate(() => { const data = new Float32Array(testAnalyser.fftSize); testAnalyser.getFloatTimeDomainData(data); return data.some(value => Math.abs(value) > 0.001); }), 'Engine emits a non-silent signal');
    await page.evaluate(() => testGPS.failure({ code: 1 }));
    await page.waitForFunction(() => document.getElementById('speed').textContent === '—');
    assert.equal(await page.locator('#gps-label').textContent(), 'GPS DENIED');
    await page.locator('#retry-gps').click();
    await page.evaluate(() => testGPS.success({ timestamp: Date.now(), coords: { latitude: 43.65, longitude: -79.38, accuracy: 5, speed: 10 } }));
    await page.waitForFunction(() => document.getElementById('speed').textContent === '36');
    await page.locator('#manual-mode').click();
    assert.ok(await page.evaluate(() => testGPS.cleared >= 2));
    assert.equal(await page.locator('#speed-caption').textContent(), 'SIMULATED SPEED');
    await page.keyboard.down('w');
    await page.waitForFunction(() => Number(document.getElementById('speed').textContent) > 10);
    await page.keyboard.up('w');
    await page.keyboard.down('s');
    await page.waitForFunction(() => document.getElementById('speed').textContent === '0');
    await page.keyboard.up('s');
    await page.locator('#neutral-gear').click();
    await page.keyboard.down('w');
    await page.waitForFunction(() => document.getElementById('drive-state').textContent === 'REV LIMITER');
    assert.equal(await page.locator('#speed').textContent(), '0');
    await page.keyboard.up('w');
    await page.locator('[data-preset="exotic"]').click();
    await page.waitForFunction(() => document.getElementById('redline').textContent === '8,500');
    await page.locator('#volume').fill('73');
    await page.locator('#pops').uncheck();
    await page.locator('#ignition').click();
    await page.waitForFunction(() => document.getElementById('rpm').textContent === '0');
    await page.reload();
    assert.equal(await page.locator('#volume').inputValue(), '73');
    assert.equal(await page.locator('#pops').isChecked(), false);
    assert.equal(await page.locator('[data-preset="exotic"]').getAttribute('aria-pressed'), 'true');
    await fs.mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
    for (const width of [1440, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `No horizontal overflow at ${width}px`);
    }
    await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: GPS, recovery, audio signal, pedals, limiter, settings, responsive layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
