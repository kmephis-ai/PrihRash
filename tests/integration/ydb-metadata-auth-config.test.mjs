import assert from 'node:assert/strict';
import test from 'node:test';
import {
  YANDEX_CLOUD_METADATA_AUTH,
  YdbJsV6DataTransportError,
  createYdbJsV6MetadataDataClient,
} from '../../dist/integration/ydb/ydbJsV6DataTransport.js';

test('Yandex metadata auth uses the documented GCE-compatible endpoint and flavor', () => {
  assert.deepEqual(YANDEX_CLOUD_METADATA_AUTH, {
    endpoint: 'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token',
    flavor: 'Google',
  });
  assert.equal(Object.isFrozen(YANDEX_CLOUD_METADATA_AUTH), true);
});

test('metadata client config fails before SDK metadata/network access', async () => {
  await assert.rejects(
    () => createYdbJsV6MetadataDataClient({ connectionString: '' }),
    (error) => error instanceof YdbJsV6DataTransportError
      && error.code === 'CLIENT_CONFIG_INVALID',
  );

  await assert.rejects(
    () => createYdbJsV6MetadataDataClient({
      connectionString: 'grpcs://synthetic.invalid:2135/?database=/synthetic',
      poolMaxSize: 0,
    }),
    (error) => error instanceof YdbJsV6DataTransportError
      && error.code === 'CLIENT_CONFIG_INVALID',
  );
});
