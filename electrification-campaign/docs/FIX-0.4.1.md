# 0.4.1: country map / mask startup fix

This is a targeted fix for the v0.4 archive startup error in Assets.preload.
Electrical simulation, objectives, economy and region terrain are unchanged.

## Root cause

The supplied country SVG files had only `viewBox="0 0 392.56 339.57"`,
not explicit pixel width and height. Chromium decoded them as 173 x 150.
All six region PNG masks were 1501 x 1282. They were also tightly cropped
around the country rather than the full SVG viewport. Simply skipping the
size check or stretching the mask would not fix the registration.

## Changes

- Both country SVG files explicitly use a 1280 x 800 canvas.
- All six alpha masks use the same canvas and are registered to the country
  outline. They are not stretched edge-to-edge onto the full map.
- Dark/light background colors are explicit; the source SVG had its fill
  layer hidden, so its previous light version was mostly transparent.
- Interactive city positions follow the new shared canvas. Static city
  labels are removed from the SVG to avoid double labels.
- Runtime size checks are retained and report both actual sizes.
- `scripts/check-assets.mjs` no longer silently skips SVGs without explicit
  dimensions when comparing map/mask image pairs.
- `npm run dev` runs the asset preflight via `predev`.
- `npm run test:assets` covers the original viewBox-only regression.
- The bundled standalone directory is rebuilt with the same corrected files.

Registration parameters are in `map-registration-v041.json`.

## Apply to an existing installation

Stop Vite. Extract the patch ZIP into the existing project directory (the
one containing package.json), allowing replacements. Restart:

```sh
npm run dev
```

Then hard-refresh the browser. Dependency versions have not changed;
installing npm packages again is not required for this patch.

## Verification scope

Passed: native TypeScript type-check, asset validation, standalone build,
six asset regression tests, and direct decoding of both SVGs and all six
PNG masks in Chromium. The decoded dimensions are 1280 x 800 throughout.
The focused Chromium test also passed Assets.preload for the country layers,
light-map compositing, city coordinates inside their own masks, and terrain
loading / initial population for all six regions (10 consumers and 4 objectives
per region). Report: country-mask-verification-v041.json.
This is not a full UI or gameplay playthrough.

The npm registry is inaccessible from the build environment (EAI_AGAIN),
so a fresh npm/Vite installation was not verified here. Chromium HTTP
navigation is blocked by environment policy. In-memory browser tests,
where included, use actual compiled modules and image bytes but a test
resource loader and localStorage double, not a real HTTP origin.
