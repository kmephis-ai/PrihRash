import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'web');
const output = join(root, '.artifacts', 'r2-ui-preview');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const files = [
  'app.mjs',
  'operation-markup.mjs',
  'presentation.mjs',
  'preview-transport.mjs',
  'preview-writer.mjs',
  'preview-writer-outbox.mjs',
  'preview-writer.css',
  'reader-cache.mjs',
  'reader-filter-options-view.mjs',
  'reader-filters.mjs',
  'reader-load.mjs',
  'reader-refresh.mjs',
  'reader-sync-status.mjs',
  'reader-view.mjs',
  'styles.css',
];

for (const file of files) await cp(join(source, file), join(output, file));
await cp(join(source, 'index.html'), join(output, 'app-shell.html'));
await cp(join(source, 'preview.html'), join(output, 'index.html'));

const bootstrap = await readFile(join(source, 'preview-bootstrap.mjs'), 'utf8');
await writeFile(
  join(output, 'preview-bootstrap.mjs'),
  bootstrap.replace("fetch('./index.html'", "fetch('./app-shell.html'"),
  'utf8',
);

await writeFile(join(output, '.nojekyll'), '', 'utf8');
console.log(`R2 synthetic UI preview built at ${output}`);
