import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngHeader(bytes) {
  assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), 'expected PNG signature');
  assert.equal(bytes.readUInt32BE(8), 13, 'IHDR must be 13 bytes');
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

test('PWA manifest exposes the minimum local install icons without changing existing shell identity', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../web/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'PrihRash');
  assert.equal(manifest.short_name, 'PrihRash');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#f5f5f4');
  assert.equal(manifest.theme_color, '#f5f5f4');
  assert.equal(manifest.lang, 'ru');
  assert.deepEqual(manifest.icons, [
    { src: '/icons/app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: '/icons/app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ]);
});

test('declared install icons are real opaque RGB PNGs with exact dimensions', async () => {
  for (const size of [192, 512]) {
    const url = new URL(`../../web/icons/app-${size}.png`, import.meta.url);
    await access(url);
    const header = pngHeader(await readFile(url));
    assert.deepEqual(header, { width: size, height: size, bitDepth: 8, colorType: 2 });
  }
});

test('service worker v21 delivers changed shell assets while API requests stay outside Cache Storage', async () => {
  const sw = await readFile(new URL('../../web/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /prihrash-shell-v21/u);
  assert.match(sw, /'\/styles\.css'/u);
  assert.match(sw, /'\/presentation\.mjs'/u);
  assert.match(sw, /'\/operation-markup\.mjs'/u);
  assert.match(sw, /'\/icons\/app-192\.png'/u);
  assert.match(sw, /'\/icons\/app-512\.png'/u);
  assert.match(sw, /key\.startsWith\('prihrash-shell-'\).*key !== CACHE/u);
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/u);
});

test('note presentation wraps long literal context instead of widening the page', async () => {
  const styles = await readFile(new URL('../../web/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.operation-card__note \{[^}]*overflow-wrap: anywhere;/u);
  assert.match(styles, /\.operation-table__note \{[^}]*overflow-wrap: anywhere;/u);
});
