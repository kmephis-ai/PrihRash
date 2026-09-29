import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function classifyExactMainCiRun(run, expectedRunId, expectedSha) {
  if (!run || typeof run !== 'object' || Array.isArray(run)
    || typeof expectedRunId !== 'string' || !/^[1-9][0-9]*$/.test(expectedRunId)
    || typeof expectedSha !== 'string' || !/^[0-9a-f]{40}$/.test(expectedSha)) {
    return 'CI_RUN_INPUT_INVALID';
  }
  if (run.id !== Number(expectedRunId)
    || run.name !== 'CI'
    || run.head_sha !== expectedSha
    || run.head_branch !== 'main'
    || !['push', 'workflow_dispatch'].includes(run.event)
    || run.status !== 'completed'
    || run.conclusion !== 'success') {
    return 'CI_RUN_NOT_EXACT_SUCCESS';
  }
  return 'CI_RUN_EXACT_SUCCESS';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path, expectedRunId, expectedSha] = process.argv.slice(2);
  if (!path) {
    process.stdout.write('CI_RUN_INPUT_INVALID\n');
    process.exitCode = 2;
  } else {
    try {
      const run = JSON.parse(await readFile(path, 'utf8'));
      process.stdout.write(`${classifyExactMainCiRun(run, expectedRunId, expectedSha)}\n`);
    } catch {
      process.stdout.write('CI_RUN_METADATA_INVALID\n');
    }
  }
}
