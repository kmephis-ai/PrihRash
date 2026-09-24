import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../../.github/workflows/r1-initial-controlled-rebuild.yml', import.meta.url),
  'utf8',
);
const runtime = await readFile(
  new URL('../../src/runtime/yandexCloudWu7TemporaryThrottlingFunction.ts', import.meta.url),
  'utf8',
);
const exactSource = await readFile(
  new URL('../../scripts/exact-source-artifact.mjs', import.meta.url),
  'utf8',
);
const ci = await readFile(
  new URL('../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);
const packageJson = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
);

test('temporary throttling gate is explicit, optional, and bound to #758-style authority', () => {
  assert.match(workflow, /temporary_throttling_gate_issue:/);
  assert.match(workflow, /Provider-Authority: WU7_TEMPORARY_THROTTLING_14/);
  assert.match(workflow, /Temporary-Max-Throttling-RU-S: 14/);
  assert.match(workflow, /Restore-Throttling-RU-S: 10/);
  assert.match(workflow, /Provisioned-RCU-Change: FORBIDDEN/);
  assert.match(workflow, /IAM-Widening: FORBIDDEN/);
  assert.match(workflow, /External-Temporary-Throttling-Gate: #/);
});

test('temporary package has no Google payload surface and uses the existing runtime service account', () => {
  const start = workflow.indexOf('- name: Deploy temporary-throttling-only Function version');
  const end = workflow.indexOf('- name: Deploy initial-controlled-rebuild-only Function version');
  assert.ok(start >= 0 && end > start);
  const block = workflow.slice(start, end);
  assert.match(block, /index\.wu7TemporaryThrottlingHandler/);
  assert.match(block, /\.artifacts\/yandex-wu7-temporary-throttling-function/);
  assert.match(block, /--service-account-id "\$PRIHRASH_YC_FUNCTION_SA_ID"/);
  assert.match(block, /key=ydb_connection_string/);
  assert.doesNotMatch(block, /GOOGLE_|initial_bootstrap_private_historical_evidence/);
  assert.doesNotMatch(block, /set-access-bindings|add-access-binding|iam\.serviceAccounts\./);
});

test('10→14→controlled invoke→10 ordering is structural and restore is always guarded', () => {
  const initial = workflow.indexOf('- name: Prove temporary throttling tag and exact initial 10 RU/s');
  const set14 = workflow.indexOf('- name: Set temporary throttling to exact 14 RU/s');
  const invoke = workflow.indexOf('- name: Invoke exact controlled rebuild tag synchronously once');
  const restore = workflow.indexOf('- name: Restore temporary throttling to exact 10 RU/s');
  const publish = workflow.indexOf('- name: Publish temporary throttling evidence');
  assert.ok(initial >= 0 && set14 > initial && invoke > set14 && restore > invoke && publish > restore);
  assert.match(workflow, /if: \$\{\{ always\(\) && inputs\.temporary_throttling_gate_issue != '' \}\}/);
  assert.match(workflow, /--data '\{"action":"SET_14"\}'/);
  assert.match(workflow, /--data '\{"action":"RESTORE_10"\}'/);
  assert.match(workflow, /--data '\{"action":"READ"\}'/);
  assert.match(workflow, /\.throttlingRcuLimit == 10/);
  assert.match(workflow, /\.provisionedRcuLimit == 0/);
  assert.match(workflow, /set-classification\.json/);
  assert.match(workflow, /restore-classification\.json/);
  assert.match(workflow, /finalState:\$finalState/);
  assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/r1-wu7-temp-throttling-evidence\//);
});

test('runtime mutates only the exact throttling field and waits a terminal operation', () => {
  assert.match(runtime, /INITIAL_LIMIT = 10/);
  assert.match(runtime, /TEMPORARY_LIMIT = 14/);
  assert.match(runtime, /UPDATE_MASK = 'serverlessDatabase\.throttlingRcuLimit'/);
  assert.match(runtime, /method: 'PATCH'/);
  assert.match(runtime, /serverlessDatabase: \{ throttlingRcuLimit: String\(target\) \}/);
  assert.match(runtime, /OPERATION_POLL_LIMIT = 150/);
  assert.match(runtime, /OPERATION_POLL_MS = 2_000/);
  assert.match(runtime, /'Idempotency-Key': idempotencyKey/);
  assert.match(runtime, /crypto\.randomUUID\(\)/);
  assert.match(runtime, /result\.value\.done === undefined \? false : result\.value\.done/);
  assert.match(runtime, /UPDATE_AUTH/);
  assert.match(runtime, /UPDATE_TRANSPORT/);
  assert.match(runtime, /UPDATE_NOT_TERMINAL/);
  assert.doesNotMatch(runtime, /operation\.api\.cloud\.yandex\.net|OPERATIONS_API|waitForOperation/);
  assert.match(workflow, /--execution-timeout 360s/);
  assert.ok(runtime.includes("return hasError ? 'FAILED' : 'DONE';"));
  assert.doesNotMatch(
    runtime.slice(runtime.indexOf('const body = JSON.stringify'), runtime.indexOf('let operationId')),
    /enableThrottlingRcuLimit|provisionedRcuLimit/,
  );
});

test('canonical exact-source artifact contains the temporary provider package', () => {
  assert.match(exactSource, /'yandex-wu7-temporary-throttling-function'/);
  assert.match(ci, /\.artifacts\/yandex-wu7-temporary-throttling-function\//);
  assert.match(packageJson.scripts.check, /package:wu7-temp-throttling:from-build/);
  assert.match(
    packageJson.scripts['package:wu7-temp-throttling:from-build'],
    /verify-yandex-wu7-temporary-throttling-package\.mjs/,
  );
});
