import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = [
  'AGENTS.md',
  'docs/R1_COMPLETION_SPRINT.md',
  'docs/R1_INITIAL_SHADOW_BOOTSTRAP_RUNBOOK.md',
];

async function read(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('R1 provider incident hold is canonical, fail-closed and separate from write authority', async () => {
  for (const path of files) {
    const source = await read(path);
    assert.match(source, /Provider-Incident-Hold: ACTIVE/);
    assert.match(source, /Provider-Incident-ID: 2092/);
    assert.match(source, /Provider-Resource-Creation: LIMITED_BY_OFFICIAL_STATUS/);
    assert.match(source, /CreateVersion-Rearm: NOT_AUTHORIZED/);
    assert.match(source, /Issue #630 comment `6064782861`/);
    assert.match(source, /повторно запрашивать Owner decision для этой одной попытки не требуется/);
    assert.match(source, /отдельный exact-main marker PR/);
    assert.match(source, /status source недоступен, устарел или\s+двусмыслен, hold остаётся/);
    assert.match(source, /HTML scraping\/parsing status\.yandex\.cloud не становится runtime\s+dependency R1/);
  }
});

test('provider incident hold remains tied to the observed builder failure rather than inventing a new cause', async () => {
  for (const path of files) {
    const source = await read(path);
    assert.match(source, /ABORTED \/ PROVIDER_BUILDER_UNAVAILABLE/);
    assert.match(source, /создание новых cloud resources[\s\S]{0,160}может быть ограничено/);
    assert.doesNotMatch(source, /Provider-Incident-Hold: RESOLVED/);
    assert.doesNotMatch(source, /CreateVersion-Rearm: AUTHORIZED/);
  }
});
