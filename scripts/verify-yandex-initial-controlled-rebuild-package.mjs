import { access, readFile, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const ARTIFACT_ROOT = resolve(ROOT, '.artifacts', 'yandex-initial-controlled-rebuild-function');
const rootPackage = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
const runtimePackage = JSON.parse(await readFile(resolve(ARTIFACT_ROOT, 'package.json'), 'utf8'));

const EXPECTED_INDEX_SOURCE = `const MODULE_LOAD_FAILURE = Object.freeze({
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

export function initialControlledRebuildPreparationDiagnosticHandler(event, context) {
  return invokeRuntimeHandler('initialControlledRebuildPreparationDiagnosticHandler', event, context);
}
`;

const fail = (message) => { throw new Error(`YANDEX_INITIAL_CONTROLLED_REBUILD_PACKAGE_INVALID: ${message}`); };
async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else if (entry.isFile()) result.push(relative(ARTIFACT_ROOT, path).split(sep).join('/'));
    else fail(`unsupported filesystem entry: ${entry.name}`);
  }
  return result.sort();
}

for (const required of [
  'index.js',
  'package.json',
  'dist/runtime/initialBootstrapJob.js',
  'dist/runtime/initialControlledRebuildJob.js',
  'dist/runtime/yandexCloudInitialControlledRebuildFunction.js',
]) await access(resolve(ARTIFACT_ROOT, required));

if (await readFile(resolve(ARTIFACT_ROOT, 'index.js'), 'utf8') !== EXPECTED_INDEX_SOURCE) {
  fail('root index.js is not the reviewed controlled-rebuild-only guarded handler shim');
}
try {
  const runtimeModule = await import(pathToFileURL(
    resolve(ARTIFACT_ROOT, 'dist/runtime/yandexCloudInitialControlledRebuildFunction.js'),
  ).href);
  if (typeof runtimeModule.initialControlledRebuildHandler !== 'function') fail('runtime handler export is missing');
  if (typeof runtimeModule.initialControlledRebuildSwapRecoveryDiagnosticHandler !== 'function') {
    fail('runtime swap recovery diagnostic handler export is missing');
  }
  if (typeof runtimeModule.initialControlledRebuildPreparationDiagnosticHandler !== 'function') {
    fail('runtime preparation diagnostic handler export is missing');
  }
} catch {
  fail('runtime module import failed');
}

if (runtimePackage.name !== 'prihrash-yandex-initial-controlled-rebuild-function') fail('unexpected package name');
if (runtimePackage.version !== rootPackage.version) fail('version differs from root package');
if (runtimePackage.private !== true || runtimePackage.type !== 'module') fail('runtime package metadata mismatch');
if (JSON.stringify(runtimePackage.engines) !== JSON.stringify(rootPackage.engines)) fail('Node engine mismatch');
if (JSON.stringify(runtimePackage.dependencies) !== JSON.stringify(rootPackage.dependencies)) fail('dependencies mismatch');
for (const key of ['devDependencies', 'scripts', 'optionalDependencies', 'peerDependencies']) {
  if (Object.hasOwn(runtimePackage, key)) fail(`forbidden package key: ${key}`);
}

const files = await filesUnder(ARTIFACT_ROOT);
const runtimeFiles = files.filter((file) => file.startsWith('dist/runtime/'));
const allowedRuntimeFiles = [
  'dist/runtime/initialBootstrapJob.d.ts',
  'dist/runtime/initialBootstrapJob.js',
  'dist/runtime/initialBootstrapJob.js.map',
  'dist/runtime/initialControlledRebuildJob.d.ts',
  'dist/runtime/initialControlledRebuildJob.js',
  'dist/runtime/initialControlledRebuildJob.js.map',
  'dist/runtime/yandexCloudInitialControlledRebuildFunction.d.ts',
  'dist/runtime/yandexCloudInitialControlledRebuildFunction.js',
  'dist/runtime/yandexCloudInitialControlledRebuildFunction.js.map',
].filter((file) => files.includes(file)).sort();
if (JSON.stringify(runtimeFiles) !== JSON.stringify(allowedRuntimeFiles)) {
  fail(`runtime surface is not controlled-rebuild-only: ${runtimeFiles.join(',')}`);
}
for (const forbidden of [
  'dist/integration/ydb/ydbJsV6SchemaBootstrapClient.js',
  'dist/runtime/yandexCloudScheduledSyncFunction.js',
  'dist/runtime/scheduledSyncJob.js',
  'dist/runtime/scheduledSyncReadinessProbe.js',
  'dist/runtime/yandexCloudInitialBootstrapFunction.js',
  'dist/runtime/yandexCloudInitialBootstrapRecoveryFunction.js',
  'dist/runtime/yandexCloudSchemaBootstrapFunction.js',
  'dist/runtime/yandexCloudSchemaUpgrade003Function.js',
]) {
  if (files.includes(forbidden)) fail(`forbidden runtime content: ${forbidden}`);
}
const forbiddenPrefixes = ['tests/', 'docs/', 'db/', 'scripts/', '.github/', 'private/', 'node_modules/'];
for (const file of files) {
  if (forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) fail(`forbidden path: ${file}`);
  if (file === '.env' || file.startsWith('.env.') || file.endsWith('.private.json')) fail(`private/config path: ${file}`);
}
if (files.some((file) => !['index.js', 'package.json'].includes(file) && !file.startsWith('dist/'))) {
  fail('unexpected top-level deployment content');
}
process.stdout.write(`Yandex initial controlled rebuild package verified: ${files.length} files\n`);
