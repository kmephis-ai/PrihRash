import { access, readFile, readdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ARTIFACT_ROOT = resolve(ROOT, '.artifacts', 'yandex-scheduled-sync-function');
const rootPackage = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
const runtimePackage = JSON.parse(await readFile(resolve(ARTIFACT_ROOT, 'package.json'), 'utf8'));

const fail = (message) => {
  throw new Error(`YANDEX_FUNCTION_PACKAGE_INVALID: ${message}`);
};

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
  'dist/runtime/yandexCloudScheduledSyncFunction.js',
  'dist/runtime/scheduledSyncReadinessProbe.js',
  'dist/runtime/scheduledSyncJob.js',
]) {
  await access(resolve(ARTIFACT_ROOT, required));
}

const indexSource = await readFile(resolve(ARTIFACT_ROOT, 'index.js'), 'utf8');
if (indexSource !== "export { handler, readinessHandler } from './dist/runtime/yandexCloudScheduledSyncFunction.js';\n") {
  fail('root index.js is not the reviewed handler shim');
}

if (runtimePackage.name !== 'prihrash-yandex-scheduled-sync-function') fail('unexpected package name');
if (runtimePackage.version !== rootPackage.version) fail('version differs from root package');
if (runtimePackage.private !== true || runtimePackage.type !== 'module') fail('runtime package metadata mismatch');
if (JSON.stringify(runtimePackage.engines) !== JSON.stringify(rootPackage.engines)) fail('Node engine mismatch');
if (JSON.stringify(runtimePackage.dependencies) !== JSON.stringify(rootPackage.dependencies)) {
  fail('runtime dependencies differ from exact-pinned root dependencies');
}
for (const forbiddenKey of ['devDependencies', 'scripts', 'optionalDependencies', 'peerDependencies']) {
  if (Object.hasOwn(runtimePackage, forbiddenKey)) fail(`forbidden package key: ${forbiddenKey}`);
}

const files = await filesUnder(ARTIFACT_ROOT);
const forbiddenPrefixes = ['tests/', 'docs/', 'db/', 'scripts/', '.github/', 'private/', 'node_modules/'];
for (const file of files) {
  if (forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) fail(`forbidden path: ${file}`);
  if (file === '.env' || file.startsWith('.env.') || file.endsWith('.private.json')) {
    fail(`private/config path: ${file}`);
  }
}
if (files.some((file) => !['index.js', 'package.json'].includes(file) && !file.startsWith('dist/'))) {
  fail('unexpected top-level deployment content');
}

process.stdout.write(`Yandex Function package verified: ${files.length} files\n`);
