# R1 Scheduled Sync Runtime

## Admission boundary

До любых incremental writes scheduled invocation обязан сначала прочитать свежий полный authoritative Google snapshot и provider evidence о MigrationRun history, затем вызвать pure admission policy.

Вход admission:

- digest свежего полного source snapshot;
- последний доказанный `COMMITTED` MigrationRun либо `null`;
- все незавершённые `STAGING` / `VALIDATED` MigrationRun.

Решения:

- `RECOVERY_REQUIRED` — существует хотя бы один незавершённый run; новый sync запрещён;
- `BOOTSTRAP_REQUIRED` — нет доказанного COMMITTED baseline; scheduled runtime не запускает bootstrap автоматически;
- `NO_CHANGE` — свежий digest точно равен digest последнего COMMITTED baseline; новый MigrationRun не создаётся;
- `START_INCREMENTAL` — clean COMMITTED baseline существует и fresh digest изменился.

## Fail-closed rules

- `FAILED` MigrationRun никогда не является baseline;
- malformed baseline/incomplete evidence не игнорируется и не нормализуется, а блокирует admission;
- пустой либо неканонический digest блокирует admission;
- незавершённый run имеет приоритет над `NO_CHANGE`, `START_INCREMENTAL` и `BOOTSTRAP_REQUIRED`;
- admission не пишет в YDB, не меняет Google и не выполняет recovery автоматически;
- private financial payload не входит в admission result и не должен попадать в logs/evidence.

## Single-observation handoff

`START_INCREMENTAL` относится к конкретному fresh authoritative observation. Runtime не имеет права после admission повторно читать source и молча обрабатывать уже другой snapshot.

Поэтому application-layer invocation:

1. читает full source observation ровно один раз;
2. выполняет admission по digest именно этого observation;
3. при `START_INCREMENTAL` передаёт incremental runner тот же immutable observation/opaque snapshot handle;
4. при остальных решениях incremental runner не вызывается;
5. наружу возвращает только safe decision/digest status, без snapshot payload.

Это устраняет TOCTOU между admission и incremental processing, не превращая raw financial payload в operational evidence.

## Google read boundary

Concrete Google Sheets reader запрашивает только canonical `Ответы на форму (11)` range `A:K`, использует `userEnteredValue`, проверяет exact spreadsheet/sheet metadata и source schema fail-closed, затем строит immutable observation. Typed A–K rows преобразуются одним canonical projection в `RawPayloadV2 + row digest`, поэтому sequence lineage и revision evidence используют один и тот же source fact.

## Atomic run claim

Read-only admission не является distributed lock. Два scheduler invocation могут одновременно получить `START_INCREMENTAL`, поэтому STAGING run нельзя просто записывать после preflight без повторной проверки provider state.

Перед первой metadata mutation runtime обязан иметь уже рассчитанный candidate `MigrationRun` с финальными immutable counters и затем выполнить atomic claim:

1. открыть `YdbAdapter.serializableReadWrite`;
2. внутри этой transaction повторно прочитать relevant `COMMITTED/STAGING/VALIDATED` run evidence;
3. fail-closed, если существует любой `STAGING/VALIDATED` run;
4. exact latest `COMMITTED` baseline должен совпасть с baseline, использованным для candidate computation;
5. только после этого выполнить `INSERT INTO migration_runs` нового `STAGING` run — не `UPSERT`;
6. read-back того же run внутри transaction должен точно совпасть с candidate;
7. serialization conflict / commit-outcome-unknown не превращается в success и уходит в существующий recovery boundary.

Claim не добавляет lock table или новый lifecycle state: serializable transaction связывает recheck baseline и единственный STAGING insert. Financial current-state promotion по-прежнему происходит только после candidate validation через существующий atomic promotion path.

## Следующая runtime boundary

Следующий S-unit должен материализовать verified current YDB evidence, нужный существующему incremental candidate pipeline, а затем собрать thin application runner вокруг уже доказанных lineage/semantic/delta/validation/promotion компонентов. Таймер/cron не содержит financial semantics: scheduler только инициирует одну runtime invocation, policy остаётся в application layer.
