import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function createFakeNodeCli(tempPrefix, source) {
  const directory = await mkdtemp(join(tmpdir(), tempPrefix));

  if (process.platform === 'win32') {
    const payloadPath = join(directory, 'yc.cjs');
    const path = join(directory, 'yc.cmd');
    await writeFile(payloadPath, `${source}\n`, 'utf8');
    await writeFile(path, `@echo off\r\n"${process.execPath}" "%~dp0yc.cjs" %*\r\n`, 'utf8');
    return { directory, path };
  }

  const path = join(directory, 'yc');
  await writeFile(path, `#!/usr/bin/env node\n${source}\n`, 'utf8');
  await chmod(path, 0o755);
  return { directory, path };
}
