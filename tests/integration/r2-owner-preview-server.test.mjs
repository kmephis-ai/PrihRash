import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  R2_PREVIEW_DEFAULT_PORT,
  R2_PREVIEW_HOST,
  listenR2Preview,
  parsePreviewPort,
} from '../../scripts/serve-r2-ui-preview.mjs';

const root = new URL('../..', import.meta.url);

async function createPreviewFixture(prefix = 'prihrash-r2-preview-') {
  const tempRoot = await mkdtemp(join(tmpdir(), prefix));
  const previewRoot = join(tempRoot, 'preview');
  await mkdir(previewRoot, { recursive: true });
  await Promise.all([
    writeFile(join(previewRoot, 'index.html'), '<!doctype html><script type="module" src="./preview-bootstrap.mjs"></script>', 'utf8'),
    writeFile(join(previewRoot, 'preview-bootstrap.mjs'), "import './app.mjs';\n", 'utf8'),
    writeFile(join(previewRoot, 'app.mjs'), "document.body.dataset.preview = 'synthetic';\n", 'utf8'),
    writeFile(join(previewRoot, 'styles.css'), 'body { margin: 0; }\n', 'utf8'),
    writeFile(join(tempRoot, 'outside-secret.txt'), 'MUST_NOT_LEAK', 'utf8'),
  ]);
  return { tempRoot, previewRoot };
}

async function createCliFixture() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'prihrash-r2-preview-cli-'));
  const scriptDir = join(tempRoot, 'scripts');
  const previewRoot = join(tempRoot, '.artifacts', 'r2-ui-preview');
  await mkdir(scriptDir, { recursive: true });
  await mkdir(previewRoot, { recursive: true });
  await cp(new URL('../../scripts/serve-r2-ui-preview.mjs', import.meta.url), join(scriptDir, 'serve-r2-ui-preview.mjs'));
  await Promise.all([
    writeFile(join(previewRoot, 'index.html'), '<!doctype html><p>synthetic preview</p>', 'utf8'),
    writeFile(join(previewRoot, 'styles.css'), 'body { margin: 0; }\n', 'utf8'),
  ]);
  return tempRoot;
}

async function rawRequest(port, path, method = 'GET') {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = request({ host: R2_PREVIEW_HOST, port, path, method }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolveRequest({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', rejectRequest);
    req.end();
  });
}

function listeningPort(server) {
  const address = server.address();
  assert.equal(typeof address, 'object');
  assert.notEqual(address, null);
  return address.port;
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, R2_PREVIEW_HOST, resolveListen);
  });
  const port = listeningPort(server);
  await new Promise((resolveClose, rejectClose) => server.close((error) => (error ? rejectClose(error) : resolveClose())));
  return port;
}

async function waitForOutput(child, pattern) {
  return new Promise((resolveOutput, rejectOutput) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      rejectOutput(new Error(`preview CLI did not become ready\nstdout=${stdout}\nstderr=${stderr}`));
    }, 5000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (pattern.test(stdout)) {
        clearTimeout(timeout);
        resolveOutput({ stdout, stderr });
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      rejectOutput(new Error(`preview CLI exited before ready: code=${code} signal=${signal}\nstdout=${stdout}\nstderr=${stderr}`));
    });
  });
}

async function waitForExit(child) {
  return new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })));
}

test('preview port parser is deterministic and fails closed for invalid/out-of-range values', () => {
  assert.equal(parsePreviewPort(), R2_PREVIEW_DEFAULT_PORT);
  assert.equal(parsePreviewPort(''), R2_PREVIEW_DEFAULT_PORT);
  assert.equal(parsePreviewPort('4174'), 4174);
  for (const invalid of ['0', '-1', '65536', '1.5', 'abc', ' 4173', '4173 ']) {
    assert.throws(() => parsePreviewPort(invalid), /R2_PREVIEW_PORT_INVALID/u);
  }
});

test('preview server binds loopback and serves only static files with no-store', async (t) => {
  const fixture = await createPreviewFixture();
  t.after(() => rm(fixture.tempRoot, { recursive: true, force: true }));
  const server = await listenR2Preview({ previewRoot: fixture.previewRoot, port: 0 });
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const address = server.address();
  assert.equal(typeof address, 'object');
  assert.notEqual(address, null);
  assert.equal(address.address, R2_PREVIEW_HOST);
  const port = listeningPort(server);

  const rootResponse = await rawRequest(port, '/');
  assert.equal(rootResponse.status, 200);
  assert.match(rootResponse.headers['content-type'], /^text\/html/u);
  assert.equal(rootResponse.headers['cache-control'], 'no-store');
  assert.match(rootResponse.body, /preview-bootstrap\.mjs/u);

  const jsResponse = await rawRequest(port, '/preview-bootstrap.mjs');
  assert.equal(jsResponse.status, 200);
  assert.match(jsResponse.headers['content-type'], /^application\/javascript/u);
  assert.equal(jsResponse.headers['cache-control'], 'no-store');

  const cssResponse = await rawRequest(port, '/styles.css');
  assert.equal(cssResponse.status, 200);
  assert.match(cssResponse.headers['content-type'], /^text\/css/u);
  assert.equal(cssResponse.headers['cache-control'], 'no-store');

  const headResponse = await rawRequest(port, '/styles.css', 'HEAD');
  assert.equal(headResponse.status, 200);
  assert.equal(headResponse.body, '');
  assert.equal(headResponse.headers['cache-control'], 'no-store');

  assert.equal((await rawRequest(port, '/not-present.txt')).status, 404);
  assert.equal((await rawRequest(port, '/styles.css', 'POST')).status, 405);
});

test('preview server rejects raw and encoded traversal without exposing files outside preview root', async (t) => {
  const fixture = await createPreviewFixture();
  t.after(() => rm(fixture.tempRoot, { recursive: true, force: true }));
  const server = await listenR2Preview({ previewRoot: fixture.previewRoot, port: 0 });
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const port = listeningPort(server);

  for (const path of [
    '/../outside-secret.txt',
    '/%2e%2e/outside-secret.txt',
    '/%2E%2E%2Foutside-secret.txt',
    '/..%2foutside-secret.txt',
    '/%2e%2e%5coutside-secret.txt',
    '//outside-secret.txt',
  ]) {
    const response = await rawRequest(port, path);
    assert.equal(response.status, 400, path);
    assert.doesNotMatch(response.body, /MUST_NOT_LEAK/u, path);
  }
});

test('owner command wiring builds before serve and keeps production/provider boundary explicit', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts['preview:r2'], 'npm run preview:build --silent && node scripts/serve-r2-ui-preview.mjs');

  const serverSource = await readFile(new URL('../../scripts/serve-r2-ui-preview.mjs', import.meta.url), 'utf8');
  assert.match(serverSource, /127\.0\.0\.1/u);
  assert.match(serverSource, /Только синтетические данные\. Реальные финансы и облачный провайдер не используются\./u);
  assert.match(serverSource, /SIGINT|SIGTERM/u);
  assert.doesNotMatch(serverSource, /0\.0\.0\.0/u);
  assert.doesNotMatch(serverSource, /beforeinstallprompt|YDB|Google/u);
});

test('preview CLI serves the artifact and terminates cleanly on SIGTERM', async (t) => {
  const cliRoot = await createCliFixture();
  t.after(() => rm(cliRoot, { recursive: true, force: true }));
  const port = await reserveLoopbackPort();
  const child = spawn(process.execPath, ['scripts/serve-r2-ui-preview.mjs'], {
    cwd: cliRoot,
    env: { ...process.env, R2_PREVIEW_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = waitForExit(child);
      child.kill('SIGTERM');
      await exit;
    }
  });

  const readyPattern = new RegExp(
    `PrihRash Reader UAT: http://${R2_PREVIEW_HOST}:${port}/[\\s\\S]*Только синтетические данные`,
    'u',
  );
  const ready = await waitForOutput(child, readyPattern);
  assert.match(ready.stdout, /Только синтетические данные/u);

  const response = await rawRequest(port, '/');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');

  const exit = waitForExit(child);
  child.kill('SIGTERM');
  const exited = await exit;
  assert.equal(exited.code, 0);
  assert.equal(exited.signal, null);
});

test('preview CLI rejects invalid R2_PREVIEW_PORT before listening', async (t) => {
  const cliRoot = await createCliFixture();
  t.after(() => rm(cliRoot, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ['scripts/serve-r2-ui-preview.mjs'], {
    cwd: cliRoot,
    env: { ...process.env, R2_PREVIEW_PORT: '65536' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /R2_PREVIEW_PORT должен быть целым числом от 1 до 65535/u);
  assert.equal(result.stdout, '');
});
