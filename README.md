# Drive Tone

A dark, muscle-car-inspired instrument panel for a 2025 Tesla Model 3. GPS speed and acceleration control an engine soundtrack; a parked playground offers hold-to-press pedals, automatic simulated shifts, and free-rev neutral mode. Includes three sound profiles, exhaust pops, a redline limiter, and remembered volume/engine preferences.

Plain HTML, CSS, and JavaScript. No dependencies, build step, API keys, account, or telemetry service.

## Run locally

```sh
python3 -m http.server 5173 --bind 127.0.0.1
```

Open http://localhost:5173. Localhost is a secure context for location access. On another device, including the Tesla, serve through **HTTPS**; a plain HTTP LAN address will generally block GPS.

## Install the licensed recordings

**Current limitation:** Audio downloads were blocked by a configuration error in the development environment's automatic approval service. The app works now using three distinctly labeled synthesized previews. It automatically uses each real recording when that file is installed.

```sh
python3 scripts/download_audio.py
```

The installer verifies each source page still links to CC0, downloads its public MP3 preview, and writes provenance to `audio/sources.json`. Then reload the app. If Freesound changes its page format or blocks automation, download the recordings from the links in [audio/CREDITS.md](audio/CREDITS.md), convert to MP3, and save with the documented filenames. Commit the three MP3 files before publishing. No recordings are downloaded by the deployment workflow, so deploying without them uses the labeled synth previews.

The classic V8 recording is a 350 Rocket, not a Camaro SS. The three profiles are expressive approximations, using a stable loop, pitch, and filtering; they are not full RPM/load recording libraries. Pops and limiter effects are synthesized in both cases.

## GitHub Pages

1. Push this repository to GitHub on `master` (or change the workflow branch to match your default branch).
2. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. Run the included **Deploy Drive Tone to GitHub Pages** workflow, or push to `master`.
4. Open the HTTPS URL shown by the workflow, typically `https://YOUR-USERNAME.github.io/tesla-engine-noise/`, in the Tesla browser.

All assets use relative URLs, including audio; project subpaths work. The workflow tests the motion logic and publishes only the site assets. Publishing hasn't been performed from this workspace.

## In the car

- Set up while parked. Choose an engine and cabin volume, then tap **Start engine** to unlock browser audio and allow GPS. Audio is never started automatically.
- **GPS drive:** the browser's native metres-per-second speed is preferred. If it isn't available, consecutive fixes estimate motion. A continuous curve combines speed with positive acceleration for RPM and load, without gear shifts.
- **Pedal playground:** fake speed is visibly labeled. Hold the throttle or brake with touch/mouse; keyboard **W/↑** and **S/↓** also work. Both pedals held means braking takes priority. Simulated automatic gears keep RPM in range. **Free rev · N** holds simulated speed at zero and lets the throttle reach the rev limiter quickly.
- **Stop engine** stops audio, releases pedals, and clears the location watch. Switching modes releases pedals and clears old GPS state. Hiding the browser stops the engine; tap Start to resume. Browser-level audio interruption also stops the engine.
- A denied, weak, stale, or implausible GPS fix never supplies motion to the soundtrack. The gauge shows unavailable speed and the running engine returns to idle. Retry location after adjusting permissions, or use the parked playground.

GPS location and estimated acceleration are approximate and may lag the real car, particularly with coordinate-derived speed. Fixes older than eight seconds, accuracy worse than 60 metres, speeds above 324 km/h, and implausible speed jumps are rejected. Small stationary movements are filtered out. Location is held only in memory; preferences store only engine choice, volume, and pops. There are no route uploads or third-party runtime requests beyond the static host. Tesla/browser behavior must still be verified on the actual vehicle; desktop testing cannot establish speaker routing or operation while driving.

## Tests

```sh
npm test
```

Uses Node's built-in test runner. Tests cover GPS native/estimated speed, jitter, jumps, stale fixes, recovery, smooth RPM behavior, pedal braking priority, automatic shifts, and neutral rev limiting. Browser behavior can be checked with `tests/browser.cjs` when Playwright is available; start the local server first. It checks the UI with mocked geolocation and the real Web Audio API.

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/browser.cjs
```

All 10 motion/audio tests and syntax checks pass. The audio tests verify distinct, finite, non-silent synthesized waveforms and normalized stereo loops with smooth boundaries. Browser integration, visual inspection, and in-car playback are **not yet verified**: the authoring environment's approval-service error prevented opening a browser or starting a preview server. The Playwright harness above is supplied for follow-up verification.

The approval error states: `404 Not Found: The API deployment for this resource does not exist.` It occurs in the external reviewer service before commands run. This project has no dependency on that API. The environment owner must restore the reviewer's configured deployment; changing app code cannot repair it. [OpenAI's auto-review documentation](https://learn.chatgpt.com/docs/sandboxing/auto-review) describes that separate review step, and [API error documentation](https://developers.openai.com/api/docs/guides/error-codes) identifies missing resources as the cause of NotFoundError.
