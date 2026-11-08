# RAZ, SVET! v0.6

TypeScript / Canvas 2D / HTML UI / Vite. Phaser is an optional host, not required for gameplay.
Do not move network logic into rendering. Do not regenerate source art during ordinary builds.

## Invariants
- The sole network topology is the symmetric adjacency matrix. Values are metres, zero means absent.
- Only poles transit ordinary power. Transformers convert HV to LV. Consumers and plants do not transit.
- Equal delivered demand fraction after cable/converter losses. Camera and icon resolution never change physical distances.
- The current objectives (factories AND settlements), not all buildings, are checked simultaneously at regional deadline.
- Runtime deposits come from generateResources(), once per campaign stage, and are included in save v6.
- Buildings must be inside region, land footprints cannot touch water; hydro's anchor must be on river mask.
- Visible icons reserve clearanceWidthM / clearanceHeightM to prevent overlap; these differ from the land footprint.
- Pause/hidden tab stops economy and time. Closed regions cannot earn income or reopen.
- Prices and refunds use actual payments. Failing placement/connection never spends money.

## Files
public/data/balance.json: economy, physics, camera, random-resource options.
public/data/assets.json: sprites and UI art paths. Only imported user graphics.
public/data/regions/*.json: regional crops, masks, consumer anchors.
src/model/resources.ts: bounded, deterministic, masked generation.
src/render/paint.ts: map, comic, sprite rendering; src/app.ts: input/UI lifecycle.
docs/ASSETS_RU.md: exact artist format. docs/POWER_MODEL_RU.md: solver assumptions.

## Checks
npm run check:native
npm test
npm run build:standalone
node tests/actual-playthrough.mjs
python3 tests/v05-browser.py  # requires Python Playwright + Chromium

After installing all npm dependencies also run npm run check && npm run build.
Browser fixture substitutes transport and localStorage, not game logic. Do not describe it as real HTTP reload verification.
See docs/VERIFICATION_RU.md for what was actually run.

Never package node_modules, caches, secrets or font binaries. Package a complete source + standalone archive, not only a patch.

## v0.6 invariants
A failed regional deadline counts once, even when several objectives are dark.
First two violations charge a fine and enter reprimand; retry preserves network/resources/objectives.
Third violation enters failed/Siberia. Strikes are campaign-wide; negative finite money is valid.
Music is one looping HTMLAudioElement. Radio art indicates message visibility, not playback.
Typography imports the user's own font locally; do not package font binaries.
New media modules: src/ui/audio.ts, typography.ts and local-media.ts (IndexedDB).
