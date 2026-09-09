import { createServer } from 'node:http';
import { lstat, realpath, readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultPreviewRoot = resolve(root, '.artifacts', 'r2-ui-preview');
export const R2_PREVIEW_HOST = '127.0.0.1';
export const R2_PREVIEW_DEFAULT_PORT = 4173;

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
});

export function parsePreviewPort(value = undefined) {
  if (value === undefined || value === '') return R2_PREVIEW_DEFAULT_PORT;
  if (!/^[1-9][0-9]{0,4}$/u.test(value)) throw new Error('R2_PREVIEW_PORT_INVALID');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('R2_PREVIEW_PORT_INVALID');
  return port;
}

function responseHeaders(contentType = 'text/plain; charset=utf-8') {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  };
}

function endText(response, statusCode, body) {
  response.writeHead(statusCode, responseHeaders());
  response.end(body);
}

function decodeRequestPath(requestUrl) {
  const rawPath = (requestUrl ?? '/').split('?', 1)[0] ?? '/';
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    throw new Error('R2_PREVIEW_PATH_INVALID');
  }

  if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.includes('\\') || decoded.includes('\0')) {
    throw new Error('R2_PREVIEW_PATH_INVALID');
  }

  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) throw new Error('R2_PREVIEW_PATH_INVALID');
  return decoded;
}

async function resolvePreviewFile(previewRoot, requestUrl) {
  const decodedPath = decodeRequestPath(requestUrl);
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.slice(1);
  const candidate = resolve(previewRoot, relativePath);
  const prefix = `${previewRoot}${sep}`;
  if (!candidate.startsWith(prefix)) throw new Error('R2_PREVIEW_PATH_INVALID');

  let info;
  try {
    info = await lstat(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
  if (!info.isFile()) return null;

  const [realRoot, realCandidate] = await Promise.all([realpath(previewRoot), realpath(candidate)]);
  if (!realCandidate.startsWith(`${realRoot}${sep}`)) throw new Error('R2_PREVIEW_PATH_INVALID');
  return realCandidate;
}

export function createR2PreviewServer({ previewRoot = defaultPreviewRoot } = {}) {
  const absoluteRoot = resolve(previewRoot);
  return createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { ...responseHeaders(), Allow: 'GET, HEAD' });
      response.end('Method Not Allowed');
      return;
    }

    let filePath;
    try {
      filePath = await resolvePreviewFile(absoluteRoot, request.url);
    } catch (error) {
      if (error?.message === 'R2_PREVIEW_PATH_INVALID') {
        endText(response, 400, 'Bad Request');
        return;
      }
      endText(response, 500, 'Preview unavailable');
      return;
    }

    if (filePath === null) {
      endText(response, 404, 'Not Found');
      return;
    }

    try {
      const body = await readFile(filePath);
      const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      response.writeHead(200, {
        ...responseHeaders(contentType),
        'Content-Length': String(body.byteLength),
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      endText(response, 500, 'Preview unavailable');
    }
  });
}

export async function listenR2Preview({
  previewRoot = defaultPreviewRoot,
  port = R2_PREVIEW_DEFAULT_PORT,
  host = R2_PREVIEW_HOST,
} = {}) {
  if (host !== R2_PREVIEW_HOST) throw new Error('R2_PREVIEW_HOST_INVALID');
  const server = createR2PreviewServer({ previewRoot });
  await new Promise((resolveListen, rejectListen) => {
    const onError = (error) => rejectListen(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolveListen();
    });
  });
  return server;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

async function main() {
  const port = parsePreviewPort(process.env.R2_PREVIEW_PORT);
  const server = await listenR2Preview({ port });
  console.log(`PrihRash Reader UAT: http://${R2_PREVIEW_HOST}:${port}/`);
  console.log('Только синтетические данные. Реальные финансы и облачный провайдер не используются.');

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await closeServer(server);
      process.exitCode = 0;
    } catch {
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    const message = error?.message === 'R2_PREVIEW_PORT_INVALID'
      ? 'R2_PREVIEW_PORT должен быть целым числом от 1 до 65535.'
      : 'Не удалось запустить локальный synthetic Reader preview.';
    console.error(message);
    process.exitCode = 1;
  });
}
