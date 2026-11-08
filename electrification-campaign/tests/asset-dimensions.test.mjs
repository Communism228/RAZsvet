import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { imageDimensions, assertSameDimensions } from '../scripts/image-dimensions.mjs';
const bytes = s => Buffer.from(s);
test('viewBox-only SVG cannot silently pass a map/mask size check', () => {
  const result = imageDimensions(bytes('<svg viewBox="0 0 392.56 339.57"></svg>'), '.svg');
  assert.equal(result, null);
  assert.throws(() => assertSameDimensions(result, [1501,1282], 'grodno'), /explicit integer/);
});
test('reads explicit pixel sizes on the SVG root, including px and single quotes', () => {
  assert.deepEqual(imageDimensions(bytes("<svg width='1280px' height='800' viewBox='0 0 1280 800'></svg>"), '.svg'), [1280,800]);
});
test('child image dimensions cannot be mistaken for root dimensions', () => {
  assert.equal(imageDimensions(bytes('<svg viewBox="0 0 10 10"><image width="1280" height="800"/></svg>'), '.svg'), null);
});
test('percent SVG dimensions are not accepted as fixed pixel dimensions', () => {
  assert.equal(imageDimensions(bytes('<svg width="100%" height="100%" viewBox="0 0 1280 800"/>'), '.svg'), null);
});
test('size mismatch reports both dimensions', () => {
  assert.throws(() => assertSameDimensions([173,150], [1501,1282], 'grodno'), /173 x 150 vs 1501 x 1282/);
});
test('country SVG files and all six masks share a 1280 x 800 pixel canvas', async () => {
  const root = new URL('../public/', import.meta.url);
  const index = JSON.parse(await readFile(new URL('data/campaign.json', root)));
  const manifest = JSON.parse(await readFile(new URL('data/assets.json', root)));
  const dark = imageDimensions(await readFile(new URL(manifest.country.dark,root)), '.svg');
  const light = imageDimensions(await readFile(new URL(manifest.country.light,root)), '.svg');
  assert.deepEqual(dark,[1280,800]); assertSameDimensions(dark,light,'dark/light');
  assert.equal(index.regions.length,6);
  for (const file of index.regions) {
    const region = JSON.parse(await readFile(new URL(file,root)));
    const size = imageDimensions(await readFile(new URL(region.countryMask,root)), '.png');
    assertSameDimensions(dark,size,region.id);
  }
});
