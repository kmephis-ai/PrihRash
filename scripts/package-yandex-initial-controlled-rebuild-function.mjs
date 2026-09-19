import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'dist');
const ARTIFACT_ROOT = resolve(ROOT, '.artifacts', 'yandex-initial-controlled-rebuild-function');
const RUNTIME_ROOT = resolve(ARTIFACT_ROOT, 'dist', 'runtime');
const ALLOWED_RUNTIME_BASENAMES = new Set([
  'initialBootstrapJob.js',
  'initialBootstrapJob.js.map',
  'initialBootstrapJob.d.ts',
  'initialControlledRebuildJob.js',
  'initialControlledRebuildJob.js.map',
  'initialControlledRebuildJob.d.ts',
  'yandexCloudInitialControlledRebuildFunction.js',
  'yandexCloudInitialControlledRebuildFunction.js.map',
  'yandexCloudInitialControlledRebuildFunction.d.ts',
]);

const rootPackage = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
const runtimePackage = {
  name: 'prihrash-yandex-initial-controlled-rebuild-function',
  version: rootPackage.version,
  private: true,
  type: 'module',
  engines: rootPackage.engines,
  dependencies: rootPackage.dependencies,
};

const INDEX_SOURCE = `const MODULE_LOAD_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED',
  jobCode: 'MODULE_LOAD_FAILED',
  phase: null,
});
const HANDLER_UNCAUGHT_FAILURE = Object.freeze({
  status: 'FAIL',
  code: 'INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED',
  jobCode: 'HANDLER_UNCAUGHT',
  phase: null,
});

async function invokeRuntimeHandler(handlerName, event, context) {
  let runtimeModule;
  try {
    runtimeModule = await import('./dist/runtime/yandexCloudInitialControlledRebuildFunction.js');
  } catch {
    return MODULE_LOAD_FAILURE;
  }

  if (typeof runtimeModule[handlerName] !== 'function') {
    return MODULE_LOAD_FAILURE;
  }

  try {
    return await runtimeModule[handlerName](event, context);
  } catch {
    return HANDLER_UNCAUGHT_FAILURE;
  }
}

export function initialControlledRebuildHandler(event, context) {
  return invokeRuntimeHandler('initialControlledRebuildHandler', event, context);
}

export function initialControlledRebuildSwapRecoveryDiagnosticHandler(event, context) {
  return invokeRuntimeHandler('initialControlledRebuildSwapRecoveryDiagnosticHandler', event, context);
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

await writeFile(resolve(ARTIFACT_ROOT, 'index.js'), INDEX_SOURCE, 'utf8');
await writeFile(resolve(ARTIFACT_ROOT, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`, 'utf8');
process.stdout.write(`${ARTIFACT_ROOT}\n`);
