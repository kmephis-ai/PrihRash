import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'dist');
const ARTIFACT_ROOT = resolve(ROOT, '.artifacts', 'yandex-initial-bootstrap-function');
const RUNTIME_ROOT = resolve(ARTIFACT_ROOT, 'dist', 'runtime');
const ALLOWED_RUNTIME_BASENAMES = new Set([
  'initialBootstrapJob.js',
  'initialBootstrapJob.js.map',
  'initialBootstrapJob.d.ts',
  'initialBootstrapReferenceAwareJob.js',
  'initialBootstrapReferenceAwareJob.js.map',
  'initialBootstrapReferenceAwareJob.d.ts',
  'initialBootstrapReferenceClaimAdapter.js',
  'initialBootstrapReferenceClaimAdapter.js.map',
  'initialBootstrapReferenceClaimAdapter.d.ts',
  'yandexCloudInitialBootstrapFunction.js',
  'yandexCloudInitialBootstrapFunction.js.map',
  'yandexCloudInitialBootstrapFunction.d.ts',
]);

const rootPackage = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
const runtimePackage = {
  name: 'prihrash-yandex-initial-bootstrap-function',
  version: rootPackage.version,
  private: true,
  type: 'module',
  engines: rootPackage.engines,
  dependencies: rootPackage.dependencies,
};

const INDEX_SOURCE = `const MODULE_LOAD_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
  runtimeCode: 'REFERENCE_FUNCTION_MODULE_LOAD_FAILED',
  applicationPhase: null,
  metadataFailureCode: null,
});
const HANDLER_UNCAUGHT_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_BOOTSTRAP_RUNTIME_FAILED',
  runtimeCode: 'REFERENCE_FUNCTION_HANDLER_UNCAUGHT',
  applicationPhase: null,
  metadataFailureCode: null,
});

export async function initialBootstrapHandler(event, context) {
  let runtimeModule;
  try {
    runtimeModule = await import('./dist/runtime/yandexCloudInitialBootstrapFunction.js');
  } catch {
    return MODULE_LOAD_FAILURE;
  }

  if (typeof runtimeModule.initialBootstrapHandler !== 'function') {
    return MODULE_LOAD_FAILURE;
  }

  try {
    return await runtimeModule.initialBootstrapHandler(event, context);
  } catch {
    return HANDLER_UNCAUGHT_FAILURE;
  }
}
`;

await rm(ARTIFACT_ROOT, { recursive: true, force: true });
await mkdir(ARTIFACT_ROOT, { recursive: true });
await cp(DIST, resolve(ARTIFACT_ROOT, 'dist'), { recursive: true });

for (const entry of await readdir(RUNTIME_ROOT, { withFileTypes: true })) {
  if (!entry.isFile() || !ALLOWED_RUNTIME_BASENAMES.has(entry.name)) {
    await rm(resolve(RUNTIME_ROOT, entry.name), { recursive: true, force: true });
  }
}
for (const file of [
  'integration/ydb/ydbJsV6SchemaBootstrapClient.js',
  'integration/ydb/ydbJsV6SchemaBootstrapClient.js.map',
  'integration/ydb/ydbJsV6SchemaBootstrapClient.d.ts',
]) {
  await rm(resolve(ARTIFACT_ROOT, 'dist', file), { force: true });
}

await writeFile(
  resolve(ARTIFACT_ROOT, 'index.js'),
  INDEX_SOURCE,
  'utf8',
);
await writeFile(
  resolve(ARTIFACT_ROOT, 'package.json'),
  `${JSON.stringify(runtimePackage, null, 2)}\n`,
  'utf8',
);

process.stdout.write(`${ARTIFACT_ROOT}\n`);
