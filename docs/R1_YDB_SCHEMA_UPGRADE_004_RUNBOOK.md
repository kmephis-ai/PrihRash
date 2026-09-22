# R1 YDB Schema Upgrade 004 Runbook

Этот runbook описывает отдельный one-shot production DDL gate для migration `004_source_record_revision_run_index.sql`.

## Причина

Read-only R1 recovery на exact `main=3521024b670917148346409be0d9482f1ec48a65` доказал privacy-safe cost bucket `GE_3000_RU` у run-scoped `REVISION_METADATA_SCAN`. Этот read обязан сохраняться: canonical migration contract требует fail-closed detection extra/duplicate/contradictory `source_record_revisions` evidence.

Physical PK таблицы:

```text
(source_record_id, revision)
```

Run-scoped predicate:

```text
migration_run_id + revision
```

Поэтому migration 004 добавляет только один synchronous secondary index:

```text
idx_source_record_revisions_run_revision
GLOBAL SYNC
ON (migration_run_id, revision)
COVER (observed_at, row_hint, row_digest, change_class)
```

`GLOBAL ASYNC` запрещён: stale index несовместим с recovery fail-closed semantics.

## Repository gate

Merge repository changes сам по себе **не применяет DDL**.

Canonical migration:

```text
db/migrations/004_source_record_revision_run_index.sql
```

Canonical workflow:

```text
.github/workflows/r1-ydb-schema-upgrade-004.yml
```

Workflow запускается только вручную из exact current `main` и требует оба input:

```text
expected_main_sha=<reviewed exact main SHA>
confirmation=OWNER_APPROVED_SCHEMA_UPGRADE_004_ONCE
```

Без отдельной явной Owner/provider-write authority этот workflow не запускается.

## Разрешённый transition после Owner approval

```text
schema_migrations exact 1+2+3
+ physical index absent
→ apply canonical migration 004
→ INSERT exact ledger version 4/checksum
→ exact ledger read-back 1+2+3+4
→ physical VIEW probe through idx_source_record_revisions_run_revision
```

Exact already-ready `1+2+3+4` + valid physical index — read-only no-op.

Fail-closed:

- missing/duplicate/wrong checksum migration evidence;
- version `5+`;
- index существует без ledger 4;
- ledger 4 существует без usable physical index;
- unexpected provider status;
- rerun attempt;
- main SHA mismatch;
- public Function or trigger present;
- missing dedicated provider identity/Lockbox boundary.

`IF NOT EXISTS`, manual ledger patch, blind replay и provider error-text publication запрещены.

## Provider-read diagnostic boundary

Live runs `35749648876` и `35750441003` на exact `main=b9ec60ba58df2a336b7d9f342dcde08b13c8d369` оба прошли exact-source, YC CLI и GitHub OIDC→WIF exchange, но fail-closed остановились **до deploy/invoke** на чтении metadata dedicated Lockbox secret. Поэтому эти runs не применяли migration 004 и не меняли YDB migration ledger.

До следующего provider attempt workflow обязан:
- read-only подтвердить WIF identity через `yc iam whoami` и exact locator `YC_R1_SCHEMA_UPGRADE_004_WIF_SERVICE_ACCOUNT_ID`;
- при ошибке `yc lockbox secret get --id` классифицировать только privacy-safe enum: `LOCKBOX_FORBIDDEN | LOCKBOX_UNAUTHENTICATED | LOCKBOX_NOT_FOUND | LOCKBOX_RATE_LIMITED | LOCKBOX_TRANSPORT_FAILED | LOCKBOX_UNCLASSIFIED`;
- не публиковать raw stderr, HTTP status, provider IDs, secret payload или endpoint/path;
- fail-closed завершиться после diagnostic code; deploy/invoke не продолжать.

Этот diagnostic patch не расширяет IAM, не меняет dedicated resource bindings и не разрешает повторный provider dispatch сам по себе. Новый live attempt допустим только после merge/CI PASS и fresh exact-main reconciliation. Повторный rerun уже завершённых failed runs запрещён.

### Scoped Lockbox lookup recovery

После diagnostic patch #749 fresh runs на `main=a6fad24116bfae1538f39a32b7ac46d802a53bc3` стабильно вернули `SCHEMA_UPGRADE_004_LOCKBOX_NOT_FOUND` на global `secret get --id`, при этом:
- WIF identity self-check PASS;
- dedicated secret ACTIVE;
- exact deploy SA имеет один direct `lockbox.viewer` binding на dedicated secret без condition;
- локальная impersonation exact той же deploy SA читает secret metadata;
- migration-003 использует тот же resource-scoped Lockbox pattern и ранее прошла успешно;
- locator `YC_R1_SCHEMA_UPGRADE_004_LOCKBOX_SECRET_ID` был повторно установлен из exact current dedicated secret и подтверждён read-back по `updatedAt`;
- deploy/invoke во всех этих failed runs были skipped, поэтому migration 004 и ledger version 4 не применялись.

Yandex CLI различает lookup по ID (global resource lookup) и lookup по name (folder-scoped). Поэтому workflow сохраняет ID lookup как primary path, но при **exact `NOT_FOUND` только** допускает read-only fallback:

```text
secret get --id <locator>
  NOT_FOUND only
→ secret get --name prihrash-r1-schema-upgrade-004 --folder-id <exact folder>
→ require returned id == locator
→ require exact name + folder
→ resolve current version
```

Fallback не разрешён для `FORBIDDEN`, `UNAUTHENTICATED`, rate-limit, transport или unclassified failure. Scoped lookup failure также STOP с privacy-safe enum. Raw stderr/provider IDs/payload не публикуются.

Этот fallback не расширяет IAM, не читает payload, не меняет provider resources и не ослабляет exact-resource proof: дальнейший deploy разрешён только после exact ID/name/folder equality.

### Temporary WIF Lockbox metadata visibility

После merge #750 exact-main run `35757658319` и locator-corrected run `35763678941` на `main=3a61fcc2d9005b0b8f9dc801d760f2d27b0b7413` оба завершились fail-closed **до deploy/invoke** с `SCHEMA_UPGRADE_004_LOCKBOX_SCOPED_NOT_FOUND`.

Read-only provider reconciliation доказал одновременно:

- Function, runtime SA, deploy SA и dedicated secret находятся в одном exact folder;
- current deploy SA имеет ровно один direct `lockbox.viewer` binding на dedicated secret, без condition;
- current deploy SA имеет exact GitHub federated credential: exact service account, subject, issuer и audience;
- local impersonation exact этой deploy SA выполняет `secret get --id`, но folder-scoped lookup по name не проходит;
- повторная запись обоих GitHub locators из current exact deploy SA/secret не изменила WIF result;
- во всех этих runs deploy Function version и migration invoke были skipped, поэтому migration 004/ledger version 4 не применялись.

Yandex Cloud WIF выдаёт IAM token service account и допускает Lockbox access от имени этого account. Официальный WIF→Lockbox pattern использует folder-level Lockbox role. Поэтому для завершения этого one-shot gate допускается **временный metadata-only recovery scope**:

```text
exact current deploy SA
+ exact current target folder
→ add folder-level lockbox.viewer
→ NO lockbox.payloadViewer for deploy SA
→ one fresh exact-main schema-upgrade-004 attempt
→ success: fresh readiness-v4
→ revoke temporary folder-level lockbox.viewer during migration-004 retirement
```

Границы:

- это только metadata visibility; deploy SA не получает доступ к secret payload;
- runtime SA сохраняет existing dedicated-secret `lockbox.payloadViewer`; его scope не расширяется;
- YDB roles, cap, Google authority, timer/cutover и controlled-rebuild authority не меняются;
- перед IAM mutation обязательны exact current `main`, green canonical verification, #748 open, no active migration-004 run и exact provider resource reconciliation;
- после known IAM grant допускается ровно один fresh workflow dispatch; старые failed runs не rerun;
- если fresh run снова останавливается до deploy/invoke, дальнейшее IAM widening запрещено; temporary folder-level `lockbox.viewer` остаётся отдельным known recovery state и должен быть revoked при abandonment/retirement;
- raw IAM/provider IDs, Lockbox payload и financial data не публикуются.

### Exact Lockbox version locator recovery

Temporary folder-level `lockbox.viewer` и полная синхронизация GitHub locators не устранили WIF anomaly: fresh exact-main run `35770005675` на `main=5bcd8d06a933e02e48ade1cb8c096609ea3b1bd4` после обновления `YC_R1_FOLDER_ID`, WIF SA locator и Lockbox secret locator снова завершился `SCHEMA_UPGRADE_004_LOCKBOX_SCOPED_NOT_FOUND` до deploy/invoke. Следовательно stale folder/SA/secret locator, resource folder mismatch и conditional binding исключены.

Дальнейшее IAM widening запрещено. Вместо этого canonical provider boundary использует owner-side exact read-only reconciliation для immutable deployment locators:

```text
exact current folder
+ exact dedicated secret name
+ exact dedicated secret id
+ exact current secret version id
+ exact runtime SA with dedicated-secret lockbox.payloadViewer
→ set GitHub locator secrets:
  YC_R1_FOLDER_ID
  YC_R1_SCHEMA_UPGRADE_004_WIF_SERVICE_ACCOUNT_ID
  YC_R1_SCHEMA_UPGRADE_004_LOCKBOX_SECRET_ID
  YC_R1_SCHEMA_UPGRADE_004_LOCKBOX_VERSION_ID
→ workflow validates all locators are present/syntactically safe
→ workflow does NOT read Lockbox metadata/payload as deploy SA
→ Cloud Functions version create receives exact secret id + version id + runtime SA
→ provider deploy failure = STOP before migration invoke
```

`YC_R1_SCHEMA_UPGRADE_004_LOCKBOX_VERSION_ID` — provider locator, не secret payload. Он не публикуется в logs/evidence и маскируется в workflow так же, как secret ID.

Безопасность сохраняется:
- deploy SA не получает `lockbox.payloadViewer`;
- runtime SA остаётся единственным account с payload access к dedicated migration-004 secret;
- Cloud Functions contract проверяет secret/version/runtime-SA при создании новой Function version; failure не допускает migration invoke;
- exact secret name/folder/current version доказываются owner-side read-only перед установкой locators;
- temporary folder-level `lockbox.viewer`, добавленный как diagnostic workaround, должен быть отозван до fresh locator-based live attempt; direct secret-level metadata binding может оставаться только если он требуется provider deploy и в любом случае retires после schema-v4 readiness;
- никакой Google/YDB financial mutation, cap increase, timer/cutover или controlled-rebuild authority этим recovery не добавляется.

После merge и green canonical verification допустим один fresh live attempt только после:
1. fresh exact-main/no-active-writer reconciliation;
2. owner-side read-only proof exact dedicated secret/folder/current version/runtime payload binding;
3. установки всех четырёх non-credential locators;
4. retirement temporary folder-level `lockbox.viewer`.

## Provider isolation

Package `.artifacts/yandex-schema-upgrade-004-function` содержит только:

- upgrade-004 handler/runtime;
- schema bootstrap YDB client primitive;
- adapter/parameter primitives;
- canonical migration 004.

Он не содержит migrations 001/002/003/005+, auth DDL, Google reader, scheduled sync, initial bootstrap, controlled rebuild или financial writer runtime.

Provider function должна оставаться private, trigger-free и использовать dedicated least-privilege runtime identity. Public GitHub evidence — только sanitized enum-shaped invoke result и exact source SHA.

## После live apply

1. Выполнить fresh exact-main `R1 Yandex readiness`.
2. Требовать `READINESS_READY` и `requiredMigrationVersion=4`.
3. Только после этого возвращаться к #630 controlled-rebuild boundary.
4. Temporary schema-upgrade-004 write authority retired.

Этот gate не разрешает controlled rebuild replay, cap increase, timer/scheduled sync activation, cutover, YDB-authoritative Writer или Google mutation.
