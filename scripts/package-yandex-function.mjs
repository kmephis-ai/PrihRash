import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'dist');
const ARTIFACT_ROOT = resolve(ROOT, '.artifacts', 'yandex-scheduled-sync-function');

const rootPackage = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
const runtimePackage = {
  name: 'prihrash-yandex-scheduled-sync-function',
  version: rootPackage.version,
  private: true,
  type: 'module',
  engines: rootPackage.engines,
  dependencies: rootPackage.dependencies,
};

await rm(ARTIFACT_ROOT, { recursive: true, force: true });
await mkdir(ARTIFACT_ROOT, { recursive: true });
await cp(DIST, resolve(ARTIFACT_ROOT, 'dist'), { recursive: true });
await writeFile(
  resolve(ARTIFACT_ROOT, 'index.js'),
  "export { handler } from './dist/runtime/yandexCloudScheduledSyncFunction.js';\n",
  'utf8',
);
await writeFile(
  resolve(ARTIFACT_ROOT, 'package.json'),
  `${JSON.stringify(runtimePackage, null, 2)}\n`,
  'utf8',
);

process.stdout.write(`${ARTIFACT_ROOT}\n`);
