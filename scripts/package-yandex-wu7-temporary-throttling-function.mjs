import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ARTIFACT_ROOT = resolve(ROOT, '.artifacts', 'yandex-wu7-temporary-throttling-function');
const rootPackage = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));

await rm(ARTIFACT_ROOT, { recursive: true, force: true });
await mkdir(resolve(ARTIFACT_ROOT, 'dist', 'runtime'), { recursive: true });

const base = 'yandexCloudWu7TemporaryThrottlingFunction';
for (const suffix of ['.js', '.js.map', '.d.ts']) {
  const source = resolve(ROOT, 'dist', 'runtime', `${base}${suffix}`);
  try {
    await copyFile(source, resolve(ARTIFACT_ROOT, 'dist', 'runtime', `${base}${suffix}`));
  } catch (error) {
    if (suffix === '.js') throw error;
  }
}

const indexSource = `const FAILURE = Object.freeze({
  status: 'STOP',
  code: 'WU7_THROTTLING_GATE_STOP',
  stage: 'CONFIG_INVALID',
});

export async function wu7TemporaryThrottlingHandler(event, context) {
  try {
    const runtime = await import('./dist/runtime/yandexCloudWu7TemporaryThrottlingFunction.js');
    if (typeof runtime.wu7TemporaryThrottlingHandler !== 'function') return FAILURE;
    return await runtime.wu7TemporaryThrottlingHandler(event, context);
  } catch {
    return FAILURE;
  }
}
`;

const runtimePackage = {
  name: 'prihrash-yandex-wu7-temporary-throttling-function',
  version: rootPackage.version,
  private: true,
  type: 'module',
  engines: rootPackage.engines,
};
await writeFile(resolve(ARTIFACT_ROOT, 'index.js'), indexSource, 'utf8');
await writeFile(resolve(ARTIFACT_ROOT, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`, 'utf8');
process.stdout.write(`${ARTIFACT_ROOT}\n`);
