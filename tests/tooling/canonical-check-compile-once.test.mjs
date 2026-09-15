import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const { scripts } = packageJson;

const packageScripts = [
  'package:function',
  'package:schema-bootstrap',
  'package:schema-upgrade-003',
  'package:initial-bootstrap',
  'package:initial-bootstrap-recovery',
];

test('canonical check emits TypeScript exactly once and reuses that dist for tests/packages', () => {
  const check = scripts.check;
  assert.equal((check.match(/npm run build/g) ?? []).length, 1);
  assert.match(check, /npm run typecheck && npm run build && npm run test:from-build/);
  assert.doesNotMatch(check, /npm test(?:\s|$)/);

  for (const name of packageScripts) {
    assert.match(check, new RegExp(`npm run ${name.replaceAll(':', '\\:')}:from-build`));
    assert.doesNotMatch(scripts[`${name}:from-build`], /npm run build/);
  }
  assert.doesNotMatch(scripts['test:from-build'], /npm run build/);
});

test('standalone test and package commands remain self-contained', () => {
  assert.match(scripts.test, /^npm run build --silent && npm run test:from-build --silent$/);

  for (const name of packageScripts) {
    assert.equal(
      scripts[name],
      `npm run build --silent && npm run ${name}:from-build --silent`,
    );
  }
});
