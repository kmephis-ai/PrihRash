# R1 Yandex readiness: provider runbook

Этот runbook — operational gate перед первым real shadow mutation. Он запускает только read-only `readinessHandler`, не создаёт timer trigger, не запускает `index.handler` и не пишет финансовые строки в YDB.

## Safety contract

Provider execution transport для #302 — **GitHub Actions → GitHub OIDC → Yandex Cloud Workload Identity Federation (WIF)**. Long-lived Yandex authorized key/OAuth token в GitHub не используется.

- Workflow запускается только вручную (`workflow_dispatch`) и только из canonical `main` repository `kmephis-ai/PrihRash`.
- WIF federated credential должен принимать только immutable GitHub subject `repo:kmephis-ai@310519475/PrihRash@1359286840:ref:refs/heads/main`. Репозиторий создан после GitHub cutoff 2026-07-15, поэтому legacy subject без owner/repository IDs для него не является canonical.
- GitHub workflow получает только short-lived OIDC/JWT и обменивает его на short-lived Yandex IAM token. IAM token маскируется и живёт только в ephemeral runner environment.
- Google spreadsheet ID, Google service-account email/private key, YDB connection string и Lockbox payload **никогда не передаются в GitHub**. Они хранятся только в Yandex Lockbox и инжектируются в Function server-side.
- В GitHub Actions secrets допустимы только два non-credential provider locator-а, которые нужны до Yandex authentication: `YC_R1_FOLDER_ID` и `YC_R1_WIF_SERVICE_ACCOUNT_ID`. Они не выводятся в logs/evidence.
- Provider IDs, Lockbox IDs/version IDs, YDB endpoint/database path, raw `yc` stdout/stderr, provider logs/screenshots не публикуются в Issues/PR/Actions evidence. Workflow держит найденные IDs только в ephemeral env/temp files и маскирует их до deploy/invoke.
- В public evidence допустим только safe status code. Для auth boundary разрешены `READINESS_OIDC_REQUEST_FAILED`, `READINESS_OIDC_CLAIMS_INVALID`, `READINESS_OIDC_ISSUER_MISMATCH`, `READINESS_OIDC_AUDIENCE_MISMATCH`, `READINESS_OIDC_SUBJECT_MISMATCH`, `READINESS_WIF_INVALID_REQUEST`, `READINESS_WIF_INVALID_GRANT`, `READINESS_WIF_INVALID_TARGET`, `READINESS_WIF_UNAUTHORIZED_CLIENT`, `READINESS_WIF_UNSUPPORTED_GRANT_TYPE` и generic `READINESS_WIF_EXCHANGE_FAILED`; provider/readiness boundary использует только коды, перечисленные ниже в разделе `One-shot safe invocation`, без публикации raw provider output.
- На этом gate запрещены `yc serverless trigger create`, timer cadence, вызов `index.handler`, bootstrap/incremental shadow writes и authority cutover.
- Любое расхождение provider state с этим contract → fail closed; не расширять IAM и не менять secret transport внутри workflow.

Этот WIF transport заменяет прежний local-CLI-only transport. Причина изменения: Yandex Cloud официально поддерживает GitHub OIDC/WIF для Cloud Functions CI/CD, а owner-facing ручная CLI orchestration оказалась хрупкой и не даёт дополнительной безопасности по сравнению с branch-bound short-lived identity.

## One-time provider bootstrap

Bootstrap выполняется владельцем в Yandex Cloud Management Console. Он не повторяется на каждом readiness run.

### 1. Dedicated readiness function

Создать private Cloud Function resource:

```text
prihrash-r1-readiness
```

Требования:

- function resource существует до запуска workflow;
- public invocation выключен;
- triggers = 0;
- версий может не быть;
- workflow создаёт только version с tag `r1-readiness`.

### 2. Runtime service account

Используется existing:

```text
prihrash-backend
```

Для #302 runtime service account должен иметь только необходимые права:

- `ydb.viewer` на `prihrash-prod` (или минимальном доказанном parent scope);
- `lockbox.payloadViewer` на readiness Lockbox secret;
- `kms.keys.encrypterDecrypter` только если secret использует customer-managed KMS key.

Известная owner/provider discovery 2026-09-08 уже привела YDB binding к `ydb.viewer` без `ydb.editor`; повторно расширять эту роль workflow не должен.

### 3. Lockbox

Создать custom secret:

```text
prihrash-r1-readiness
```

Одна current version содержит ровно четыре keys:

- `google_spreadsheet_id` → authoritative Google spreadsheet ID;
- `google_service_account_email` → Google service-account email;
- `google_service_account_private_key` → Google service-account private key;
- `ydb_connection_string` → `prihrash-prod` connection string.

Значения вводятся только через Yandex Cloud Management Console. Их нельзя переносить в GitHub Secrets/Variables, workflow dispatch inputs, Issues/PR или chat logs.

Google service account должен уже иметь read-only доступ к authoritative spreadsheet. Production code использует только Google Sheets readonly OAuth scope.

### 4. Dedicated WIF deploy identity

Создать отдельный service account:

```text
prihrash-github-readiness
```

Не использовать `prihrash-backend` как GitHub deployment identity.

Минимальная цель IAM:

- read metadata, необходимую для discovery target function/resource;
- `functions.editor` только на dedicated `prihrash-r1-readiness` function resource;
- `functions.functionInvoker` только на dedicated readiness function;
- `iam.serviceAccounts.user` только в объёме, необходимом для attachment `prihrash-backend` к version;
- Lockbox payload read **не требуется** deployment identity: workflow передаёт только secret references, payload читает runtime service account.

Если provider UI/role model требует более широкий read-only parent scope для lookup resource-by-name, разрешается только read metadata; write scope не расширять на другие functions.

### 5. Workload Identity Federation

Создать WIF в том же controlled folder:

```text
name: prihrash-github
issuer: https://token.actions.githubusercontent.com
jwks: https://token.actions.githubusercontent.com/.well-known/jwks
audience: https://github.com/kmephis-ai
```

Создать federated credential для `prihrash-github-readiness` с exact external subject:

```text
repo:kmephis-ai@310519475/PrihRash@1359286840:ref:refs/heads/main
```

Не добавлять wildcard repository/branch subjects.

### 6. GitHub Actions locator secrets

В repository Actions secrets создать только:

```text
YC_R1_FOLDER_ID
YC_R1_WIF_SERVICE_ACCOUNT_ID
```

Это non-credential locators. Они хранятся как GitHub Secrets только для automatic masking. Никаких Yandex authorized keys, OAuth tokens, IAM tokens, Lockbox payload, Google credentials или YDB connection strings в GitHub не хранить.

## Lockbox Preview gate

Перед live run проверить текущий статус Yandex Cloud Functions → Lockbox secret injection в официальной документации.

На 2026-09-08 feature помечена `Preview`. Owner отдельно разрешил Preview Functions → Lockbox для #302. Если это решение будет отозвано или provider feature станет недоступной, gate останавливается. Plaintext `--environment` workaround запрещён.

## Canonical workflow

Единственный provider workflow:

```text
.github/workflows/r1-yandex-readiness.yml
```

Он обязан:

1. подтвердить `github.repository == kmephis-ai/PrihRash` и `github.ref == refs/heads/main`;
2. checkout exact `GITHUB_SHA` без persisted GitHub credentials;
3. выполнить `npm ci --ignore-scripts --no-audit --no-fund` и literal `npm run check`;
4. установить официальный Yandex Cloud CLI до получения cloud token;
5. запросить GitHub OIDC token (`permissions.id-token=write`) с audience `https://github.com/kmephis-ai`;
6. до exchange локально декодировать только JWT payload и fail-closed сверить exact `iss`, `aud`, `sub` с canonical federation contract; mismatch публикуется только как безопасный claim-specific code без значений; затем обменять JWT на short-lived Yandex IAM token через `https://auth.yandex.cloud/oauth/token`, а отказ Yandex классифицировать только по allowlisted OAuth `error` category без публикации response body/JWT/provider IDs;
7. fail-closed проверить dedicated function: private, triggers = 0;
8. локально в runner memory разрешить runtime SA и Lockbox current version; не печатать IDs;
9. создать ровно readiness version из `.artifacts/yandex-scheduled-sync-function`;
10. повторно проверить private + zero triggers;
11. вызвать только tag `r1-readiness` через privacy-safe wrapper `npm run readiness:invoke`.

Workflow не имеет `push`, `pull_request`, `schedule` или `repository_dispatch` trigger.

## Exact package and version

Deploy source:

```text
.artifacts/yandex-scheduled-sync-function
```

`index.js` экспортирует `readinessHandler`; entrypoint version должен быть ровно:

```text
index.readinessHandler
```

Version configuration:

```text
runtime: nodejs22
memory: 128m
execution timeout: 30s
tag: r1-readiness
logging: disabled
runtime service account: prihrash-backend
```

Secret injection:

- `PRIHRASH_GOOGLE_SPREADSHEET_ID` ← `google_spreadsheet_id`;
- `PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL` ← `google_service_account_email`;
- `PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` ← `google_service_account_private_key`;
- `PRIHRASH_YDB_CONNECTION_STRING` ← `ydb_connection_string`.

## One-shot safe invocation

`npm run readiness:invoke` вызывает только tag `r1-readiness`, отключает CLI retries и захватывает provider stdout/stderr без echo.

Допустимый PASS:

```json
{"status":"PASS","code":"READINESS_READY"}
```

Он выдаётся только если provider вернул exact object:

```json
{"googleSource":"READY","ydbSchema":"READY","requiredMigrationVersion":3}
```

Safe invoke taxonomy различает только форму результата и количество allowlisted markers; raw stdout/stderr, provider IDs и payload не публикуются:

- successful `yc invoke` с malformed/non-exact stdout → `READINESS_INVOKE_OUTPUT_INVALID`;
- non-zero `yc invoke` без allowlisted runtime marker → `READINESS_INVOKE_NONZERO_UNCLASSIFIED`;
- non-zero `yc invoke` с двумя или более allowlisted runtime markers → `READINESS_INVOKE_MARKER_AMBIGUOUS`;
- spawn/timeout/buffer и прочий transport-level failure, для которого нельзя доказать numeric provider exit → `READINESS_INVOKE_FAILED`.

Если non-zero invocation содержит **ровно один** allowlisted value-free runtime marker, wrapper не печатает captured stdout/stderr и возвращает соответствующий safe code. Для Google source разрешены:

- `READINESS_GOOGLE_SPREADSHEET_ID_INVALID` — source config отклонён до чтения;
- `READINESS_GOOGLE_CREDENTIALS_INVALID` — service-account email/private-key validation отклонена до token acquisition;
- `READINESS_GOOGLE_TOKEN_ACQUISITION_FAILED` — Google OAuth token не получен или не прошёл минимальную token validation;
- `READINESS_GOOGLE_SHEETS_ACCESS_FAILED` — Google Sheets API вернул non-success HTTP response; status/body не публикуются;
- `READINESS_GOOGLE_SHEETS_RESPONSE_INVALID` — response shape нельзя безопасно интерпретировать по adapter contract;
- `READINESS_GOOGLE_SOURCE_METADATA_MISMATCH` — spreadsheet title/locale/time zone не совпали с canonical source contract;
- `READINESS_GOOGLE_SOURCE_SHEET_MISSING` — canonical sheet отсутствует;
- `READINESS_GOOGLE_SOURCE_SCHEMA_MISMATCH` — physical source headers/row shape не совпали с canonical adapter contract;
- `READINESS_GOOGLE_SOURCE_VALUE_UNSUPPORTED` — source содержит cell representation, которую canonical adapter обязан отклонить fail-closed;
- `READINESS_GOOGLE_SOURCE_READ_FAILED` — unknown/untyped Google source failure.

Для YDB/readiness lifecycle разрешены `READINESS_YDB_CLIENT_CREATE_FAILED`, `READINESS_YDB_QUERY_HEALTH_READ_FAILED`, `READINESS_YDB_MIGRATION_TABLE_RESOLUTION_FAILED`, `READINESS_YDB_MIGRATION_TABLE_ACCESS_DENIED`, `READINESS_YDB_MIGRATION_TABLE_READ_FAILED`, `READINESS_YDB_MIGRATION_SCHEMA_READ_FAILED`, `READINESS_YDB_MIGRATION_EVIDENCE_READ_FAILED`, `READINESS_YDB_ACCOUNTS_SCHEMA_READ_FAILED`, `READINESS_YDB_CATEGORIES_SCHEMA_READ_FAILED`, `READINESS_YDB_INITIAL_BOOTSTRAP_IDENTITY_MANIFEST_SCHEMA_READ_FAILED`, `READINESS_MALFORMED_SCHEMA_MIGRATION_EVIDENCE`, `READINESS_MISSING_REQUIRED_SCHEMA_MIGRATION`, `READINESS_UNEXPECTED_SCHEMA_MIGRATION`, `READINESS_YDB_CLIENT_CLOSE_FAILED`, а для generic runtime wrapper — `READINESS_RUNTIME_CONFIG_INVALID` и `READINESS_RUNTIME_FAILED`. `READINESS_YDB_QUERY_HEALTH_READ_FAILED` относится к table-independent `SELECT 1`. Если expected-column zero-row check уже упал, table-only `schema_migrations` probe классифицирует только machine-readable YDB status: `SCHEME_ERROR`/`NOT_FOUND` → `READINESS_YDB_MIGRATION_TABLE_RESOLUTION_FAILED`, `UNAUTHORIZED` → `READINESS_YDB_MIGRATION_TABLE_ACCESS_DENIED`, остальные/нетипизированные ошибки → `READINESS_YDB_MIGRATION_TABLE_READ_FAILED`; raw provider message/issues не публикуются. Если table-only read проходит, `READINESS_YDB_MIGRATION_SCHEMA_READ_FAILED` означает drift expected columns `version/checksum/applied_at`. `READINESS_YDB_MIGRATION_EVIDENCE_READ_FAILED` относится к чтению migration ledger rows; accounts/categories codes остаются zero-row checks physical migration 002; `READINESS_YDB_INITIAL_BOOTSTRAP_IDENTITY_MANIFEST_SCHEMA_READ_FAILED` — zero-row physical check migration 003 table/required columns. Эти коды различают только read-only stage/status class и не содержат YDB endpoint, database path, provider error text или query result.

`READINESS_YDB_MIGRATION_TABLE_RESOLUTION_FAILED` сам по себе **не** разрешает DDL внутри readiness workflow. Historical bootstrap `001→002` выполнялся только через `docs/R1_YDB_SCHEMA_BOOTSTRAP_RUNBOOK.md`. Forward migration `003` перед initial shadow bootstrap выполняется только через отдельный `docs/R1_YDB_SCHEMA_UPGRADE_003_RUNBOOK.md` и новую explicit provider-write authority; readiness identity остаётся `ydb.viewer`.

Отсутствующая/пустая function identity →

```json
{"status":"FAIL","code":"READINESS_CONFIG_INVALID"}
```

Provider preflight/deploy failure остаётся безопасным коротким code без raw output.

Authentication transport также fail-closed и диагностируется без раскрытия token/provider data:

- `READINESS_OIDC_REQUEST_FAILED` означает, что GitHub OIDC token не был безопасно получен/распознан.
- `READINESS_OIDC_CLAIMS_INVALID` означает, что JWT payload нельзя безопасно декодировать/распознать.
- `READINESS_OIDC_ISSUER_MISMATCH`, `READINESS_OIDC_AUDIENCE_MISMATCH`, `READINESS_OIDC_SUBJECT_MISMATCH` локализуют exact canonical claim mismatch; фактические claim values не печатаются.
- `READINESS_WIF_INVALID_REQUEST`, `READINESS_WIF_INVALID_GRANT`, `READINESS_WIF_INVALID_TARGET`, `READINESS_WIF_UNAUTHORIZED_CLIENT`, `READINESS_WIF_UNSUPPORTED_GRANT_TYPE` отражают только allowlisted OAuth `error` category от Yandex; response body/description не публикуются.
- `READINESS_WIF_EXCHANGE_FAILED` остаётся generic fallback, если Yandex отказал, но безопасная allowlisted категория не определена или 2xx response не содержит пригодного IAM token.

Любой auth code оставляет текущий readiness gate FAIL и сам по себе не разрешает расширять IAM, менять secret transport или provider write boundary.

## Exit from this gate

Только `READINESS_READY` на version, собранной из exact current canonical `main`, является current read-only provider PASS. #302 уже был закрыт историческим successful readiness после schema `001..002`; его не переоткрывают для forward migration 003. После `SCHEMA_UPGRADE_003_READY` новый `READINESS_READY` с `requiredMigrationVersion=3` подтверждает schema-v3 gate; initial shadow bootstrap разрешается только после отдельного retirement temporary migration-003 write authority.

Readiness PASS сам по себе **не** включает timer, bootstrap/incremental shadow writes, auth DDL или authority cutover.
