# Dependency cache fallback

Минимальный fallback для AI/sandbox environments, где direct npm registry egress заблокирован, но GitHub Actions и GitHub Connector доступны.

Это **не** альтернативный registry и не стандартный install path. В обычной среде всегда сначала выполняется обычный:

```bash
npm ci --ignore-scripts --no-audit --no-fund
```

Fallback допустим только после доказанного environment/network failure этого install probe.

## Contract

1. Получить exact current provider SHA после fresh discovery.
2. Создать disposable transport branch от этого SHA.
3. Скопировать `bootstrap-workflow.yml.template` в уникальный `.github/workflows/...yml` на transport branch и заменить:
   - `__BOOTSTRAP_BRANCH__`;
   - `__SOURCE_SHA__`;
   - `__ARTIFACT_NAME__`.
4. Workflow обязан завершиться `success` на exact workflow path/branch/transport SHA. Он:
   - устанавливает dependencies обычным online `npm ci` в isolated npm cache;
   - удаляет `node_modules`;
   - повторяет install через `npm ci --offline` из этого cache;
   - выполняет canonical `npm run check`;
   - публикует только one-day `npm-cache.tar.gz` + safe manifest.
5. Скачать exact named artifact через authorized connector.
6. Установить dependencies локально:

```bash
python tools/dependency-cache/install_from_artifact.py \
  --artifact-zip <artifact.zip> \
  --repo <exact-local-worktree> \
  --source-sha <exact-provider-sha>
```

7. Только после `installed=true` выполнить локально `npm run check`. Лишь реальный PASS этой команды считается full local verification PASS.

## Fail-closed invariants

Installer до mutation `node_modules` проверяет:

- artifact ZIP/TAR path safety и отсутствие links;
- exact `source_sha`, если он передан;
- SHA-256 текущих `package-lock.json` и `package.json` против manifest;
- SHA-256 cache archive;
- Node/npm major и platform/arch compatibility.

После этого `npm ci --offline` заново строит `node_modules`; stale/preexisting `node_modules` не считается evidence. Package tarball integrity по-прежнему проверяется npm против integrity из exact lockfile/content-addressed cache.

Любой mismatch → FAIL. Нельзя подменять exact artifact неизвестным cache, коммитить `node_modules`/cache в repository или объявлять local PASS только потому, что CI PASS.

## Security/privacy

Artifact содержит только npm public dependency cache и value-free manifest. Не включать credentials, tokens, env files, private provider configuration, financial data или repository working tree. Retention — один день.
