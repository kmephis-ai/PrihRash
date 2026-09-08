import assert from 'node:assert/strict';
import test from 'node:test';

import { authorizeYandexOwnerIdentity } from '../../dist/auth/yandexOwnerIdentity.js';

const CONFIG = Object.freeze({
  clientId: 'synthetic-yandex-oauth-client',
  ownerPsuid: '1.synthetic-owner.psuid',
});

function assertSafeDenial(result, code, privateMarkers = []) {
  assert.deepEqual(result, { status: 'DENIED', code });
  const serialized = JSON.stringify(result);
  for (const marker of privateMarkers) {
    assert.equal(serialized.includes(marker), false);
  }
}

test('exact configured client_id and psuid authorize only OWNER', () => {
  const result = authorizeYandexOwnerIdentity(CONFIG, {
    client_id: CONFIG.clientId,
    psuid: CONFIG.ownerPsuid,
    login: 'ignored-profile-login',
    default_email: 'ignored@example.invalid',
    arbitrary_future_provider_field: { nested: true },
  });

  assert.deepEqual(result, { status: 'AUTHORIZED', role: 'OWNER' });
  assert.equal(Object.isFrozen(result), true);
  assert.equal('member' in result, false);
});

test('wrong client_id and wrong psuid use one value-free forbidden result', () => {
  const cases = [
    { client_id: 'private-wrong-client', psuid: CONFIG.ownerPsuid },
    { client_id: CONFIG.clientId, psuid: 'private-wrong-psuid' },
    { client_id: 'private-wrong-client', psuid: 'private-wrong-psuid' },
  ];

  for (const payload of cases) {
    const result = authorizeYandexOwnerIdentity(CONFIG, payload);
    assertSafeDenial(result, 'OWNER_IDENTITY_FORBIDDEN', [payload.client_id, payload.psuid]);
  }
});

test('login or email never acts as an OWNER identity fallback', () => {
  const result = authorizeYandexOwnerIdentity(CONFIG, {
    client_id: CONFIG.clientId,
    psuid: 'private-not-owner',
    login: 'synthetic-owner-login',
    default_email: 'owner@example.invalid',
  });

  assertSafeDenial(result, 'OWNER_IDENTITY_FORBIDDEN', [
    'private-not-owner',
    'synthetic-owner-login',
    'owner@example.invalid',
  ]);
});

test('malformed or missing provider identity fails closed without reflecting payload', () => {
  const privateMarker = 'private-provider-marker';
  const cases = [
    null,
    [],
    {},
    { client_id: CONFIG.clientId },
    { psuid: CONFIG.ownerPsuid },
    { client_id: '', psuid: CONFIG.ownerPsuid },
    { client_id: CONFIG.clientId, psuid: ` ${privateMarker}` },
    { client_id: CONFIG.clientId, psuid: `${privateMarker}\n` },
    { client_id: CONFIG.clientId, psuid: privateMarker.repeat(100) },
  ];

  for (const payload of cases) {
    const result = authorizeYandexOwnerIdentity(CONFIG, payload);
    assertSafeDenial(result, 'AUTH_IDENTITY_INVALID', [privateMarker]);
  }
});

test('malformed private runtime config fails closed before provider identity comparison', () => {
  const privateMarker = 'private-config-marker';
  const cases = [
    { clientId: '', ownerPsuid: CONFIG.ownerPsuid },
    { clientId: CONFIG.clientId, ownerPsuid: ` ${privateMarker}` },
    { clientId: CONFIG.clientId, ownerPsuid: `${privateMarker}\u0000` },
    { clientId: CONFIG.clientId, ownerPsuid: privateMarker.repeat(100) },
  ];

  for (const config of cases) {
    const result = authorizeYandexOwnerIdentity(config, {
      client_id: CONFIG.clientId,
      psuid: CONFIG.ownerPsuid,
    });
    assertSafeDenial(result, 'AUTH_CONFIG_INVALID', [privateMarker]);
  }
});
