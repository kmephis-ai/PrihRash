import { access, readFile, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const ARTIFACT_ROOT = resolve(ROOT, '.artifacts', 'yandex-wu7-temporary-throttling-function');
const fail = (message) => { throw new Error(`WU7_TEMP_THROTTLING_PACKAGE_INVALID: ${message}`); };

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else if (entry.isFile()) result.push(relative(ARTIFACT_ROOT, path).split(sep).join('/'));
    else fail(`unsupported entry: ${entry.name}`);
  }
  return result.sort();
}

for (const required of [
  'index.js',
  'package.json',
  'dist/runtime/yandexCloudWu7TemporaryThrottlingFunction.js',
]) await access(resolve(ARTIFACT_ROOT, required));

const index = await readFile(resolve(ARTIFACT_ROOT, 'index.js'), 'utf8');
if (!index.includes('wu7TemporaryThrottlingHandler')) fail('guarded handler export missing');
if (index.includes('initialControlledRebuildHandler') || index.includes('readinessHandler')) {
  fail('unrelated handler surface present');
}
const runtime = await import(pathToFileURL(
  resolve(ARTIFACT_ROOT, 'dist/runtime/yandexCloudWu7TemporaryThrottlingFunction.js'),
).href);
if (typeof runtime.wu7TemporaryThrottlingHandler !== 'function') fail('runtime handler missing');

const runtimePackage = JSON.parse(await readFile(resolve(ARTIFACT_ROOT, 'package.json'), 'utf8'));
if (runtimePackage.name !== 'prihrash-yandex-wu7-temporary-throttling-function') fail('package name mismatch');
if (runtimePackage.private !== true || runtimePackage.type !== 'module') fail('package metadata mismatch');
if (Object.hasOwn(runtimePackage, 'dependencies') || Object.hasOwn(runtimePackage, 'scripts')) {
  fail('unexpected executable package surface');
}

const files = await filesUnder(ARTIFACT_ROOT);
const allowed = new Set([
  'index.js',
  'package.json',
  'dist/runtime/yandexCloudWu7TemporaryThrottlingFunction.js',
  'dist/runtime/yandexCloudWu7TemporaryThrottlingFunction.js.map',
  'dist/runtime/yandexCloudWu7TemporaryThrottlingFunction.d.ts',
]);
for (const file of files) if (!allowed.has(file)) fail(`unexpected artifact file: ${file}`);
for (const marker of ['tests/', 'docs/', 'db/', 'scripts/', '.github/', 'private/', '.env']) {
  if (files.some((file) => file.startsWith(marker))) fail(`forbidden artifact path: ${marker}`);
}
process.stdout.write(`WU7 temporary throttling package verified: ${files.length} files\n`);
