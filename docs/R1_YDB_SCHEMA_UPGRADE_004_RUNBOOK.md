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
