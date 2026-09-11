# R1 YDB schema bootstrap 001→002: provider runbook

Этот runbook — одноразовый production mutation gate для Issue #441. Он существует только потому, что live read-only readiness #14 на exact `main=14bb8ff38d62a9669e14703e5384bf94dfe030d7` доказал отсутствие `schema_migrations` в target YDB через safe code `READINESS_YDB_MIGRATION_TABLE_RESOLUTION_FAILED`.

Owner явно разрешил ровно этот authority boundary:

```text
production YDB schema bootstrap: 001_initial.sql → 002_reference_source_labels.sql
```

Migration `003_initial_bootstrap_identity_manifest.sql`, `db/auth/*`, Google→YDB shadow bootstrap, financial source rows, timer/trigger и authority cutover в этот gate **не входят**.

## Safety contract

- Provider transport: **GitHub Actions → GitHub OIDC → Yandex Cloud WIF → dedicated private schema-bootstrap Function**.
- Workflow запускается только вручную (`workflow_dispatch`) и только из canonical `main` repository `kmephis-ai/PrihRash`.
- GitHub identity привязана к immutable subject:

```text
repo:kmephis-ai@310519475/PrihRash@1359286840:ref:refs/heads/main
```

- Readiness identities не расширяются: `prihrash-backend` остаётся read-only runtime с `ydb.viewer`; `prihrash-github-readiness` не получает YDB write authority.
- Write authority живёт только у dedicated runtime service account `prihrash-schema-bootstrap` и назначается **на target YDB database**, а не на folder/cloud, если provider позволяет database-level binding.
- Dedicated GitHub deployment identity не получает `ydb.editor` и не читает Lockbox payload; она может только создать version dedicated Function и вызвать её.
- YDB connection string хранится только в dedicated Lockbox secret и передаётся Function server-side. Он не является GitHub Secret/input/env payload.
- Workflow не публикует provider IDs, YDB endpoint/database path, secret IDs/version IDs, raw `yc` stdout/stderr, raw YDB issues/messages или query results.
- Function logging выключен.
- Никакой автоматической recovery по неизвестному/частичному physical state: ambiguous state → fail closed.
- После verified bootstrap и последующего `READINESS_READY` write-capable path должен быть retired до timer/shadow scheduled sync.

## Why a separate identity

`ydb.editor` — минимальная current Yandex Managed Service for YDB service role, которая одновременно разрешает DDL/schema-object mutation и read/write queries. Поэтому её нельзя добавлять существующему readiness runtime. Provider поддерживает database-level access bindings; bootstrap SA получает `ydb.editor` только на target database.

Lockbox secret injection в Cloud Functions на 2026-09-11 всё ещё имеет статус Preview. Перед live apply проверить current provider documentation. Этот runbook не разрешает plaintext `--environment` workaround. Если Preview transport для #441 не разрешён Owner policy на момент запуска, gate останавливается до отдельного решения.

## Repository boundary

Canonical migration files:

```text
db/migrations/001_initial.sql
db/migrations/002_reference_source_labels.sql
```

Dedicated package:

```text
.artifacts/yandex-schema-bootstrap-function
```

Package содержит только exact canonical bytes `001` и `002`. В нём физически отсутствуют:

```text
db/migrations/003_initial_bootstrap_identity_manifest.sql
db/auth/001_owner_auth.sql
scheduled-sync runtime
Google source runtime
```

Bootstrap target schema version:

```text
2
```

Deterministic exact-byte migration checksums current source:

```text
1 → sha256:13afb6e86e790320efa66ca57a3f7771bdf4b0bba503f917f58b3e6952599855
2 → sha256:4d746e22e4db2327af0503d7be627741249d9bb9b8a5ca31d826a4ce526b84ed
```

Изменение canonical migration bytes меняет checksum и требует нового review/CI evidence. Workflow не принимает произвольные migration paths/versions через input.

## One-time provider bootstrap

Эти ресурсы создаются Owner-ом в Yandex Cloud Management Console до первого workflow run. Workflow намеренно не имеет provider-admin authority для их создания или выдачи IAM ролей.

### 1. Dedicated private Function

Создать Function resource:

```text
prihrash-r1-schema-bootstrap
```

Требования:

- public invocation выключен;
- triggers = 0;
- workflow создаёт только version с tag `r1-schema-bootstrap`;
- resource не переиспользуется scheduled sync/readiness runtime.

### 2. Dedicated runtime service account

Создать:

```text
prihrash-schema-bootstrap
```

Назначить только:

- `ydb.editor` **на target YDB database**;
- `lockbox.payloadViewer` **на dedicated bootstrap secret**;
- `kms.keys.encrypterDecrypter` только на конкретный KMS key, если secret использует customer-managed key.

Не назначать runtime SA folder/cloud `editor`, `admin`, `ydb.admin`, access-management roles или Google source access.

### 3. Dedicated Lockbox secret

Создать custom secret:

```text
prihrash-r1-schema-bootstrap
```

Current version содержит ровно один key:

```text
ydb_connection_string
```

Не переиспользовать readiness secret, потому что в нём есть Google credentials, которые schema-bootstrap runtime не должен уметь читать.

### 4. Dedicated GitHub deployment identity

Создать service account:

```text
prihrash-github-schema-bootstrap
```

Минимальная цель IAM:

- read metadata, необходимую для lookup dedicated resources;
- `functions.editor` только на `prihrash-r1-schema-bootstrap` Function resource;
- `functions.functionInvoker` только на эту Function;
- `iam.serviceAccounts.user` только в объёме, необходимом для attachment `prihrash-schema-bootstrap` к version.

Deployment identity **не получает** `ydb.editor`, `lockbox.payloadViewer` или права на readiness/scheduled-sync Functions.

Если provider UI требует parent read-only scope для resource lookup, разрешается только read metadata; write scope на folder/cloud не расширять.

### 5. WIF credential

Можно переиспользовать canonical WIF federation `prihrash-github`, но federated credential/service account должны быть отдельными от readiness deploy identity.

Привязать `prihrash-github-schema-bootstrap` к exact subject:

```text
repo:kmephis-ai@310519475/PrihRash@1359286840:ref:refs/heads/main
```

Не добавлять wildcard repository/branch subject.

### 6. GitHub locator secret

Добавить только non-credential locator:

```text
YC_R1_SCHEMA_BOOTSTRAP_WIF_SERVICE_ACCOUNT_ID
```

Workflow также использует existing `YC_R1_FOLDER_ID` как non-credential locator.

Не хранить в GitHub Yandex authorized key/OAuth token/IAM token, YDB connection string, Lockbox payload или provider private configuration.

## Canonical workflow

Единственный schema-bootstrap provider workflow:

```text
.github/workflows/r1-ydb-schema-bootstrap.yml
```

Он обязан:

1. подтвердить canonical repo/main и checkout exact `GITHUB_SHA` без persisted credentials;
2. выполнить `npm ci --ignore-scripts --no-audit --no-fund` и literal `npm run check`;
3. получить short-lived GitHub OIDC и сверить exact `iss/aud/sub` локально до token exchange;
4. обменять token через WIF на short-lived IAM token dedicated deploy identity;
5. fail-closed проверить dedicated Function: private + triggers=0;
6. разрешить только dedicated runtime SA и dedicated bootstrap Lockbox current version без публикации IDs;
7. deploy exact `.artifacts/yandex-schema-bootstrap-function` как `index.schemaBootstrapHandler`;
8. передать server-side только `PRIHRASH_YDB_CONNECTION_STRING` из key `ydb_connection_string`;
9. повторно проверить private + triggers=0;
10. вызвать только tag `r1-schema-bootstrap` через `npm run schema-bootstrap:invoke`.

Workflow не имеет `push`, `pull_request`, `schedule` или `repository_dispatch` trigger и не создаёт timer/trigger.

## Function configuration

```text
runtime: nodejs22
memory: 128m
execution timeout: 120s
tag: r1-schema-bootstrap
logging: disabled
runtime service account: prihrash-schema-bootstrap
```

Entrypoint:

```text
index.schemaBootstrapHandler
```

## Apply state machine

Bootstrap делает table-independent YDB health read, затем проверяет migration evidence/physical state.

Разрешены только три состояния:

1. **Fresh empty target**: `schema_migrations` отсутствует и ни одна physical table migration 001 не существует. Тогда выполняется ordered path:

```text
001 statements → INSERT ledger version 1 → exact ledger read-back
→ physical migration-1 verification
→ 002 statements → INSERT ledger version 2 → exact ledger read-back
→ final physical/read-back verification
```

2. **Exact checkpoint version 1**: ledger содержит только exact version 1 с current checksum, все physical migration-1 tables присутствуют, а оба migration-2 columns отсутствуют. Разрешён только resume `002 → ledger 2 → final read-back`.

3. **Exact already-ready versions 1+2**: оба exact ledger rows/checksums присутствуют, required physical schema/FinanceProfile read-back проходит. Invocation становится read-only no-op и возвращает READY.

Любой другой state fail-closed. В частности:

- existing empty `schema_migrations` ledger;
- часть tables migration 001 без exact ledger 1;
- часть/оба migration-2 columns без exact ledger 2;
- duplicate/malformed rows;
- checksum mismatch;
- migration version `3+`;
- missing baseline table при ledger 1/2;
- unexpected FinanceProfile seed.

Нельзя вручную «дописать ledger», удалять/создавать отдельные tables/columns или применять migration 003 для обхода failure code.

## Safe result

Допустимый PASS wrapper:

```json
{"status":"PASS","code":"SCHEMA_BOOTSTRAP_READY"}
```

Он выдаётся только для exact Function result:

```json
{"ydbSchema":"READY","appliedMigrationVersions":[1,2]}
```

Runtime safe codes:

- `SCHEMA_BOOTSTRAP_RUNTIME_CONFIG_INVALID`
- `SCHEMA_BOOTSTRAP_MIGRATION_BUNDLE_INVALID`
- `SCHEMA_BOOTSTRAP_YDB_CLIENT_CREATE_FAILED`
- `SCHEMA_BOOTSTRAP_YDB_HEALTH_READ_FAILED`
- `SCHEMA_BOOTSTRAP_YDB_ACCESS_DENIED`
- `SCHEMA_BOOTSTRAP_YDB_PREFLIGHT_READ_FAILED`
- `SCHEMA_BOOTSTRAP_PARTIAL_SCHEMA_STATE`
- `SCHEMA_BOOTSTRAP_UNEXPECTED_MIGRATION_EVIDENCE`
- `SCHEMA_BOOTSTRAP_MIGRATION_001_APPLY_FAILED`
- `SCHEMA_BOOTSTRAP_MIGRATION_001_EVIDENCE_FAILED`
- `SCHEMA_BOOTSTRAP_MIGRATION_002_APPLY_FAILED`
- `SCHEMA_BOOTSTRAP_MIGRATION_002_EVIDENCE_FAILED`
- `SCHEMA_BOOTSTRAP_FINAL_READBACK_FAILED`
- `SCHEMA_BOOTSTRAP_YDB_CLIENT_CLOSE_FAILED`

Invoke wrapper также может вернуть `SCHEMA_BOOTSTRAP_CONFIG_INVALID`, `SCHEMA_BOOTSTRAP_INVOKE_FAILED`, `SCHEMA_BOOTSTRAP_INVOKE_OUTPUT_INVALID`, `SCHEMA_BOOTSTRAP_INVOKE_NONZERO_UNCLASSIFIED` или `SCHEMA_BOOTSTRAP_INVOKE_MARKER_AMBIGUOUS`.

Provider/OIDC/WIF/deploy boundary публикует только `SCHEMA_BOOTSTRAP_*` status codes; raw provider output остаётся внутри ephemeral runner temp files.

## After a PASS

`SCHEMA_BOOTSTRAP_READY` **не закрывает #302** и не разрешает shadow financial writes.

Следующий обязательный evidence step:

1. fresh reconcile exact `main`;
2. вручную запустить canonical `R1 Yandex readiness` из exact current `main`;
3. требовать exact `READINESS_READY`;
4. только после этого зафиксировать #302 readiness PASS и сделать fresh R1 mutation boundary.

Если readiness после bootstrap возвращает новый safe failure code, продолжать только с этого слоя; не расширять schema/IAM автоматически.

## Retirement condition

После `SCHEMA_BOOTSTRAP_READY` + последующего `READINESS_READY`, **до** включения timer/scheduled shadow sync:

- снять `ydb.editor` с `prihrash-schema-bootstrap` на target database;
- снять `lockbox.payloadViewer` (и KMS role, если был) с bootstrap runtime SA;
- disable/delete dedicated federated credential для `prihrash-github-schema-bootstrap`;
- удалить/disable dedicated bootstrap Function/secret, если они больше не нужны для доказанной recovery procedure;
- удалить GitHub locator `YC_R1_SCHEMA_BOOTSTRAP_WIF_SERVICE_ACCOUNT_ID`, если corresponding identity retired.

Retirement выполняется Owner-ом/provider-admin boundary. Workflow специально **не** получает IAM admin authority для самоотзыва ролей.

Если bootstrap остановился с partial/ambiguous state, write authority не использовать для ручного ремонта. Сначала зафиксировать safe code и провести отдельный bounded recovery review.
