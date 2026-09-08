# R1 Yandex readiness: provider runbook

Этот runbook — operational gate перед первым real shadow mutation. Он запускает только read-only `readinessHandler` и не создаёт timer trigger, не запускает `handler` и не пишет финансовые строки в YDB.

## Safety contract

- Выполнять только в локальной/provider-capable сессии с Yandex Cloud CLI и разрешённым доступом к нужному cloud/folder.
- Не выполнять provider deploy/invoke через public GitHub Actions и не переносить туда credentials, Lockbox identifiers, YDB endpoint/database path, Google spreadsheet ID или service-account data.
- Не публиковать raw `yc` stdout/stderr, function/version IDs, secret IDs/version IDs, connection strings, provider logs или screenshots в Issues/PR/CI evidence.
- В GitHub допустим только safe итог wrapper-а: `READINESS_READY`, `READINESS_CONFIG_INVALID` или `READINESS_INVOKE_FAILED`.
- `PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` никогда не передавать через `--environment`, shell literal, committed file или workflow secret public-repo job.
- На этом gate запрещены `yc serverless trigger create`, timer cadence и вызов `index.handler`.
- Если provider state расходится с этим contract, остановить gate до выяснения; не импровизировать более широкие IAM roles или secret transport.

## Provider prerequisites

Перед deploy сделать fresh local discovery и убедиться, что используются нужные cloud/folder/function/service account. Raw discovery output остаётся локальным.

Target function resource должен быть private и **не иметь ни одного trigger**, включая trigger, который вызывает default/`$latest` version. Создание новой version меняет provider version state, поэтому существующий trigger на том же function resource делает readiness deploy небезопасным. Если trigger существует — остановить gate; не переиспользовать этот function resource без отдельного provider review.

Identity, выполняющая authenticated one-shot invoke, должна иметь `functions.functionInvoker` на target function (или унаследованное минимально достаточное право). Не делать readiness function public ради упрощения вызова. Deploy identity должна уже иметь право создавать function version; этот runbook не расширяет её IAM сам.

Readiness function service account должен иметь только необходимые права:

- `ydb.viewer` на target YDB database (или на минимальном родительском scope) для connection/read queries;
- `lockbox.payloadViewer` на используемый Lockbox secret;
- `kms.keys.encrypterDecrypter` на KMS key только если secret зашифрован customer-managed KMS key.

Google service account должен уже иметь read-only доступ к authoritative spreadsheet. Production code использует только Google Sheets readonly OAuth scope.

### Lockbox Preview gate

Перед выполнением отдельно проверить текущий статус Yandex Cloud Functions → Lockbox secret injection в официальной документации. На 2026-09-08 функция помечена `Preview`.

Если owner policy не разрешает Preview, **остановить R1 provider gate**. Не заменять Lockbox на `--environment` с secret values и не коммитить альтернативное secret transport решение без отдельного review.

## Exact package

Начинать с fresh checkout canonical `main` и зафиксировать его SHA локально. SHA можно публиковать; provider identifiers — нельзя.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run privacy
npm test
npm run package:function
```

Deploy source — только проверенный каталог:

```text
.artifacts/yandex-scheduled-sync-function
```

`index.js` этого package экспортирует `readinessHandler`; deploy entrypoint должен быть ровно `index.readinessHandler`.

## Private local variables

Следующие значения задаются только в локальной provider-capable shell. Не вставлять их значения в Issue/PR/comment/log evidence.

```bash
export PRIHRASH_YC_FUNCTION_ID='<local-only>'
export PRIHRASH_YC_FUNCTION_SA_ID='<local-only>'
export PRIHRASH_LOCKBOX_SECRET_ID='<local-only>'
export PRIHRASH_LOCKBOX_VERSION_ID='<local-only>'
```

Предпочтительно один Lockbox secret version с четырьмя keys, соответствующими existing runtime environment:

- `google_spreadsheet_id` → `PRIHRASH_GOOGLE_SPREADSHEET_ID`;
- `google_service_account_email` → `PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL`;
- `google_service_account_private_key` → `PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`;
- `ydb_connection_string` → `PRIHRASH_YDB_CONNECTION_STRING`.

## Create readiness-only version

Создать новую version trigger-free function resource. Версия должна быть отдельной от future timer deployment и получить operational tag `r1-readiness`. В рамках конкретного evidence cycle tag считается pinned: не переназначать его на другую version между deploy verification и invocation.

```bash
yc serverless function version create \
  --function-id "$PRIHRASH_YC_FUNCTION_ID" \
  --runtime nodejs22 \
  --entrypoint index.readinessHandler \
  --memory 128m \
  --execution-timeout 30s \
  --source-path .artifacts/yandex-scheduled-sync-function \
  --service-account-id "$PRIHRASH_YC_FUNCTION_SA_ID" \
  --tags r1-readiness \
  --metadata-options gce-http-endpoint=enabled,aws-v1-http-endpoint=disabled \
  --no-logging \
  --secret "environment-variable=PRIHRASH_GOOGLE_SPREADSHEET_ID,id=${PRIHRASH_LOCKBOX_SECRET_ID},version-id=${PRIHRASH_LOCKBOX_VERSION_ID},key=google_spreadsheet_id" \
  --secret "environment-variable=PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL,id=${PRIHRASH_LOCKBOX_SECRET_ID},version-id=${PRIHRASH_LOCKBOX_VERSION_ID},key=google_service_account_email" \
  --secret "environment-variable=PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,id=${PRIHRASH_LOCKBOX_SECRET_ID},version-id=${PRIHRASH_LOCKBOX_VERSION_ID},key=google_service_account_private_key" \
  --secret "environment-variable=PRIHRASH_YDB_CONNECTION_STRING,id=${PRIHRASH_LOCKBOX_SECRET_ID},version-id=${PRIHRASH_LOCKBOX_VERSION_ID},key=ydb_connection_string"
```

Не добавлять trigger. Локально проверить, что `r1-readiness` указывает на только что созданную version, function остаётся private и target function resource по-прежнему не имеет triggers вообще. Provider output не переносить в GitHub.

## One-shot safe invocation

Safe wrapper всегда вызывает только tag `r1-readiness`, отключает CLI retries и захватывает raw provider stdout/stderr без echo.

```bash
export PRIHRASH_YANDEX_READINESS_FUNCTION_ID="$PRIHRASH_YC_FUNCTION_ID"
npm run readiness:invoke
```

Допустимый public evidence:

```json
{"status":"PASS","code":"READINESS_READY"}
```

`PASS` выдаётся только если provider вернул exact object:

```json
{"googleSource":"READY","ydbSchema":"READY","requiredMigrationVersion":2}
```

Любой non-zero `yc`, spawn/timeout/buffer error, malformed JSON, лишний key или любое отличающееся значение сворачивается в:

```json
{"status":"FAIL","code":"READINESS_INVOKE_FAILED"}
```

Отсутствующий/пустой function ID сворачивается в:

```json
{"status":"FAIL","code":"READINESS_CONFIG_INVALID"}
```

При `FAIL` не копировать raw provider output в GitHub. Диагностику выполнять локально, начиная с permissions/config/provider health, сохраняя privacy contract.

## Exit from this gate

Только `READINESS_READY` на version, собранной из exact current canonical `main`, разрешает перейти к следующему R1 operational item. Это **не** является разрешением включить timer или автоматически выполнить bootstrap/incremental writes: следующий mutation item начинается только после fresh discovery и отдельной acceptance boundary.
