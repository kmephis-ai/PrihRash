import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanonicalSourceDigest } from '../../dist/integration/google/canonicalSourceDigest.js';

test('canonical source digest matches known SHA-256 UTF-8 vector', () => {
  const digest = createCanonicalSourceDigest();
  assert.equal(
    digest.digestCanonicalSnapshot('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('row and snapshot boundaries use the same exact canonical byte digest', () => {
  const digest = createCanonicalSourceDigest();
  const input = 'synthetic|строка|\n|123';
  const snapshot = digest.digestCanonicalSnapshot(input);
  const row = digest.digestCanonicalRow(input);

  assert.equal(snapshot, row);
  assert.match(snapshot, /^[0-9a-f]{64}$/);
  assert.equal(digest.digestCanonicalRow(input), row);
});

test('digest is sensitive to exact canonical serialization bytes', () => {
  const digest = createCanonicalSourceDigest();

  assert.notEqual(
    digest.digestCanonicalRow('Synthetic'),
    digest.digestCanonicalRow('synthetic'),
  );
  assert.notEqual(
    digest.digestCanonicalRow('é'),
    digest.digestCanonicalRow('e\u0301'),
  );
  assert.notEqual(
    digest.digestCanonicalSnapshot('line\n'),
    digest.digestCanonicalSnapshot('line\r\n'),
  );
});
