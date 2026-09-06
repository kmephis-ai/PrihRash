import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountBootstrapKey,
  categoryBootstrapKey,
  mapLegacyVikaFlag,
  normalizeSourceLabel,
} from '../../dist/reference/bootstrap.js';

test('bootstrap normalization is limited to Unicode NFC and outer trim', () => {
  assert.equal(normalizeSourceLabel('  Карта Visa  '), 'Карта Visa');
  assert.notEqual(normalizeSourceLabel('VISA'), normalizeSourceLabel('Visa'));
});

test('expense and income categories with same label remain distinct', () => {
  assert.notEqual(categoryBootstrapKey('EXPENSE', 'Пример'), categoryBootstrapKey('INCOME', 'Пример'));
});

test('account bootstrap key is RUB-specific and does not invent aliases', () => {
  assert.equal(accountBootstrapKey(' Карта Credit '), 'Карта Credit\u0000RUB');
  assert.notEqual(accountBootstrapKey('Credit'), accountBootstrapKey('Карта Credit'));
});

test('legacy Vika mapping is one-way evidence only', () => {
  assert.equal(mapLegacyVikaFlag('Да'), 'VIKA');
  assert.equal(mapLegacyVikaFlag(null), null);
  assert.equal(mapLegacyVikaFlag(''), null);
  assert.equal(mapLegacyVikaFlag('да'), null);
});
