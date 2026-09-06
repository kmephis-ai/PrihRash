import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const checkedExtensions = new Set(['.ts', '.mjs', '.json', '.yml', '.yaml']);
const ignoredDirs = new Set(['node_modules', 'dist', '.git']);
const violations = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!checkedExtensions.has(extname(entry.name))) continue;
    const text = await readFile(path, 'utf8');
    const rel = relative(root, path);
    text.split('\n').forEach((line, index) => {
      if (/\s+$/.test(line)) violations.push(`${rel}:${index + 1}: trailing whitespace`);
      if (line.includes('\t')) violations.push(`${rel}:${index + 1}: tab character`);
    });
    if (rel.startsWith('src/') && /console\.log\s*\(/.test(text)) {
      violations.push(`${rel}: console.log is forbidden in src`);
    }
  }
}

await walk(root);
if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
}
