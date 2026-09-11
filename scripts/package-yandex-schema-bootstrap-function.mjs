import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'dist');
const ARTIFACT_ROOT = resolve(ROOT, '.artifacts', 'yandex-schema-bootstrap-function');
const rootPackage = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
const dependencyNames = [
  '@ydbjs/api',
  '@ydbjs/auth',
  '@ydbjs/core',
  '@ydbjs/query',
  '@ydbjs/value',
];
const dependencies = Object.fromEntries(dependencyNames.map((name) => {
  const version = rootPackage.dependencies?.[name];
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`YANDEX_SCHEMA_BOOTSTRAP_PACKAGE_INVALID: missing root dependency ${name}`);
  }
  return [name, version];
}));
const runtimePackage = {
  name: 'prihrash-yandex-schema-bootstrap-function',
  version: rootPackage.version,
  private: true,
  type: 'module',
  engines: rootPackage.engines,
  dependencies,
};

const distFiles = [
  'runtime/yandexCloudSchemaBootstrapFunction.js',
  'runtime/ydbSchemaBootstrap.js',
  'integration/ydb/ydbJsV6SchemaBootstrapClient.js',
  'integration/ydb/adapter.js',
  'integration/ydb/parameters.js',
];

await rm(ARTIFACT_ROOT, { recursive: true, force: true });
for (const file of distFiles) {
  const target = resolve(ARTIFACT_ROOT, 'dist', file);
  await mkdir(dirname(target), { recursive: true });
  await cp(resolve(DIST, file), target);
}
await mkdir(resolve(ARTIFACT_ROOT, 'migrations'), { recursive: true });
await cp(resolve(ROOT, 'db', 'migrations', '001_initial.sql'), resolve(ARTIFACT_ROOT, 'migrations', '001_initial.sql'));
await cp(resolve(ROOT, 'db', 'migrations', '002_reference_source_labels.sql'), resolve(ARTIFACT_ROOT, 'migrations', '002_reference_source_labels.sql'));
await writeFile(
  resolve(ARTIFACT_ROOT, 'index.js'),
  "export { schemaBootstrapHandler } from './dist/runtime/yandexCloudSchemaBootstrapFunction.js';\n",
  'utf8',
);
await writeFile(
  resolve(ARTIFACT_ROOT, 'package.json'),
  `${JSON.stringify(runtimePackage, null, 2)}\n`,
  'utf8',
);

process.stdout.write(`${ARTIFACT_ROOT}\n`);
