import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const ignoredDirs = new Set(['node_modules', 'dist', '.git']);
const textExtensions = new Set(['.ts', '.mjs', '.json', '.md', '.yml', '.yaml']);
const forbiddenNameFragments = ['.private.', 'ПрихРасхOnline.csv', 'ПрихРасхOnline.xlsx'];
const secretPatterns = [
  /AIza[0-9A-Za-z_-]{20,}/,
  /gh[pousr]_[0-9A-Za-z]{20,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const violations = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const path = join(dir, entry.name);
    const rel = relative(root, path);
    if (entry.isDirectory()) {
      if (entry.name === 'private') violations.push(`${rel}: private directory must not be tracked`);
      await walk(path);
      continue;
    }
    if (forbiddenNameFragments.some((fragment) => entry.name.includes(fragment))) {
      violations.push(`${rel}: private provider export filename is forbidden`);
    }
    if (!textExtensions.has(extname(entry.name))) continue;
    const text = await readFile(path, 'utf8');
    for (const pattern of secretPatterns) {
      if (pattern.test(text)) violations.push(`${rel}: possible secret pattern`);
    }
  }
}

await walk(root);
if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
}
