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

Concrete Google Sheets reader запрашивает только canonical `Ответы на форму (11)` range `A:K`, использует `userEnteredValue`, проверяет exact spreadsheet/sheet metadata и source schema fail-closed, затем строит immutable observation. Typed A–K rows преобразуются одним canonical projection в `RawPayloadV3 + row digest`, поэтому sequence lineage и revision evidence используют один и тот же source fact.

Для доказанного header-only source-schema перехода v2→v3 full snapshot digest меняется вместе с exact header vector, но row lineage digest сохраняет v2-compatible framing при неизменённых A–K cells. Это предотвращает массовые ложные revisions только из-за `adapter_schema_version`; новые/реально изменённые observations сохраняют v3 provenance.

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

## Validation, reconciliation и promotion

Ordinary incremental runtime не materializes отдельные staging tables для будущего post-change current state.

После admission тот же authoritative observation проходит existing lineage/semantic/candidate pipeline относительно exact last `COMMITTED` baseline. До claim runtime уже имеет:

- full post-change candidate и его expected reconciliation snapshot;
- exact verified baseline current evidence (`SourceRecord` + canonical Transaction rows), прочитанное согласованно с baseline `MigrationRun`;
- prepared source/transaction delta intents с optimistic preconditions относительно того же baseline.

### Independent pre-promotion evidence

Pre-promotion reconciliation использует **две разные construction paths**:

1. **Expected path** — aggregate snapshot строится из full post-change candidate.
2. **Roll-forward path** — отдельный механический projector начинает с exact verified baseline provider rows и применяет только prepared delta intents по stable identity и explicit optimistic preconditions. Он не читает full candidate arrays и не делает новый Google/source normalization pass.

Roll-forward path обязан:

- сохранить baseline row без изменения, если для её identity нет delta intent;
- для `CREATE_*` добавить ровно candidate payload из соответствующего intent;
- для `UPDATE_SOURCE_RECORD` заменить только exact baseline SourceRecord при совпадении expected revision/digest/state/link/resolution guards;
- для `REPLACE_TRANSACTION` заменить только exact baseline Transaction при совпадении expected version;
- fail-closed при missing/duplicate target, predicate mismatch, duplicate intent, unsupported delete/operation или malformed row;
- после mechanical replay посчитать тот же reconciliation vocabulary: SourceRecord count, transaction/type counts, totals by type/category/account, classification counts, legacy-close count и INVALID/AMBIGUOUS/MISSING counts.

Затем expected candidate aggregates сравниваются с independently constructed roll-forward aggregates. `MATCHED` означает exact equality соответствующего check. Любой `MISMATCH`, `NOT_CHECKED` либо construction error блокирует `VALIDATED`; никакой check нельзя заполнять hardcoded `MATCHED`.

Это independent **construction evidence**, но не новая financial authority: финансовый смысл по-прежнему происходит из leased authoritative Google observation и canonical normalizer. Цель roll-forward — независимо доказать, что prepared delta действительно преобразует exact verified baseline в тот post-change aggregate state, который заявляет candidate, и поймать omission/extra/divergence между candidate и write intent без второго semantics engine.

Source-observation coverage, unresolved lineage и candidate/delta invariants остаются отдельными fail-closed guards и не считаются заменёнными этим aggregate comparison.

Operational reconciliation result наружу содержит только check statuses и безопасный mismatch count. Amounts, descriptions, raw source payload и private aggregate values не публикуются в GitHub/log evidence.

### Lifecycle после reconciliation

1. expected + roll-forward comparison рассчитывается до claim из immutable candidate/delta и exact verified baseline evidence; successful comparison сам по себе ещё не означает lifecycle success;
2. atomic claim повторно проверяет provider run history/baseline и только затем создаёт exact candidate run как `STAGING`;
3. validation gate на уже claimed `STAGING` run проверяет run/counters, candidate/delta guards, unresolved lineage и переданное reconciliation evidence; любой blocker запрещает `VALIDATED`;
4. при отсутствии blockers `STAGING → VALIDATED` означает только разрешение на atomic promotion;
5. exact previous provider state защищается optimistic predicates внутри одной atomic promotion transaction, которая применяет delta и commit marker;
6. expected post-change candidate **не** сравнивается с pre-promotion YDB current rows как будто delta уже materialized;
7. `VALIDATED` сам по себе не является verified shadow state; verified baseline по-прежнему только последний `COMMITTED` run;
8. post-commit current-state read-back/reconciliation — отдельная verification/recovery boundary; mismatch требует recovery/incident handling и не разрешает считать сомнительный state частично verified.

Controlled bootstrap/rebuild остаётся другим механизмом: там candidate может быть materialized в staging и reconciliation выполняется против staging evidence до явного promotion. Эти staging semantics не переносятся автоматически на ordinary incremental sync.

## Следующая runtime boundary

После реализации roll-forward reconciliation evidence следующий S-unit должен подключить его к thin application composition вместе с concrete reference resolver, identity allocation, Google/YDB bindings и уже доказанными admission/claim/validation/promotion components. Таймер/cron не содержит financial semantics: scheduler только инициирует одну runtime invocation, policy остаётся в application layer.
