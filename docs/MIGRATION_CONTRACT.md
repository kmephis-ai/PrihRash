# Migration Contract — Google Sheets → YDB

## 1. Цель

Миграция должна сохранить финансовый смысл лучше, чем текущий Google workflow после cleanup, и при этом не угадывать неизвестное.

До cutover:

`Google Sheets authoritative → YDB shadow`.

## 2. Scope

Authoritative transactional source:

`Ответы на форму (11)`.

Reference-only:

`Доход`, `Расход`, `Доход Весь период`, `Расход Весь период`, `Месячные`, `План расходов`.

Остальные листы не читаются migration engine.

## 3. Pipeline

Всегда:

`Google row → SourceRecord → SourceRecordRevision → Normalizer → canonical Transaction`.

Google legacy schema не выходит за integration layer. Точная физическая схема и stable adapter keys определены в `SOURCE_ADAPTER_CONTRACT.md`; normalizer не использует parser-generated duplicate header names.

## 4. SourceRecord

```text
SourceRecord

id
source_type = GOOGLE_SHEETS
source_sheet
first_seen_at
last_seen_at
last_row_hint
current_digest
state
classification:
  FINANCIAL_RECORD | LEGACY_PERIOD_CLOSE | NON_FINANCIAL | INVALID | AMBIGUOUS
normalization_status
transaction_id?
current_revision
```

Row number — только locator hint, не identity.

## 5. SourceRecordRevision

Append-only история изменившихся наблюдений:

```text
source_record_id
revision
migration_run_id
observed_at
row_hint
row_digest
change_class
raw_payload
```

Revision создаётся только при first sight или digest change. Обычный повторный sync без изменений не плодит историю.

### Raw payload schema v3

`raw_payload` — приватный diagnostic/provenance payload с **всеми 11 source fields** через stable adapter keys и с сохранением физического cell kind. Schema v1 (`string | null`) была заменена v2 **до первого production shadow bootstrap**, потому что v1 стирала различие между numeric cell и numeric-looking source string. После live physical-header drift 2026-09-10 current source observations используют **v3**: cell encoding и stable adapter keys не меняются, но новый `adapter_schema_version` явно фиксирует новый exact physical source contract вместо тихого переиспользования v2.

Synthetic example:

```json
{
  "adapter_schema_version": 3,
  "date": {"kind":"NUMBER","value":"45292.5"},
  "operation_type": {"kind":"STRING","value":"Расход"},
  "expense_account": {"kind":"STRING","value":"Synthetic Account"},
  "expense_category": {"kind":"STRING","value":"Synthetic Category"},
  "description": {"kind":"STRING","value":"Synthetic Description"},
  "expense_amount": {"kind":"NUMBER","value":"123.45"},
  "income_account": null,
  "income_category": null,
  "income_amount": null,
  "vika_flag": null,
  "note": null
}
```

Правила:

- `row_hint` хранится отдельно и не дублируется как identity;
- blank → `null`;
- source text → `{kind:"STRING", value:<text>}` после только технически безопасной NFC/line-ending normalization;
- Google `numberValue` → `{kind:"NUMBER", value:<canonical plain decimal>}` без locale parsing и без arithmetic rounding;
- numeric-looking `STRING` **никогда** не повышается до `NUMBER`;
- formula/bool/error в authoritative A–K → fail-closed source review; formula не вычисляется importer-ом как финансовое значение;
- source date/datetime сохраняется как typed Google Sheets serial number, включая fractional time component;
- v2 и v3 используют одинаковые stable adapter keys и typed cell encoding; decoder обязан читать оба доказанных provenance schema, но concrete current Google projection после 2026-09-10 emit только v3;
- изменение physical source schema **или** provenance encoding требует нового `adapter_schema_version`, а не тихого переиспользования старого payload contract;
- payload никогда не публикуется в GitHub/log evidence.

#### Decoder contract v2/v3

- financial operation определяется только exact `Расход` / `Доход` из typed `STRING`;
- active amount — только `expense_amount` для `Расход` и `income_amount` для `Доход`; inactive amount column не интерпретируется как financial value;
- active amount обязан быть typed `NUMBER`; `STRING`, formula-like/unsupported cell или non-canonical decimal → fail-closed;
- RUB minor units вычисляются integer parsing-ом canonical decimal: максимум 2 fractional digits, без rounding; unsafe integer range → fail-closed;
- Google Sheets serial date использует epoch `1899-12-30`; whole serial day задаёт `occurred_on`, fractional part остаётся raw provenance и не превращается в отдельный guessed timestamp;
- text fields decoder принимает только typed `STRING | null`; numeric/text coercion запрещён;
- existing negative/zero financial semantics по-прежнему решает classifier/normalizer, decoder их не переопределяет.


## 6. Raw digest

Deterministic digest строится из нормализованного технического представления всех source columns.

Нормализация включает cell kind и canonical value: `NUMBER 123` и `STRING "123"` обязаны иметь разные digest inputs. Допускаются только стабильное представление blank, typed numbers, typed strings, dates, line endings и Unicode.

`adapter_schema_version` не является source column и сам по себе не должен фабриковать revision существующей строки. Для доказанного header-only перехода v2→v3, где A–K stable keys, cell encoding и финансовая интерпретация не изменились, lineage `row_digest` сохраняет v2-compatible canonical framing. Поэтому unchanged A–K row получает тот же row digest, а новая/реально изменённая observation сохраняет уже v3 `raw_payload`. Это правило ограничено доказанным v2→v3 переходом и не является разрешением автоматически переиспользовать digest framing для будущей schema evolution.

Full `source_snapshot_digest` включает exact current header vector, поэтому физическая смена header всё равно меняет snapshot digest и проходит обычный admission/reconciliation lifecycle; она лишь не превращает все неизменённые rows в ложные revisions.

Digest не является Transaction ID.

Одинаковые строки могут быть двумя реальными независимыми операциями.

## 7. Initial full read

На household-scale правильность важнее premature incremental optimization.

Каждый sync может читать весь used range, строить snapshot digest и при `NO_CHANGE` завершаться без diff/write.

Позже возможен optimisation path, но периодический full reconciliation должен сохраниться.

## 8. Sequence reconciliation

Для определения lineage между snapshots использовать deterministic sequence diff/LCS/Myers-equivalent.

Нельзя использовать AI/fuzzy semantic matching как автоматический financial identity resolver.

### Safe cases

- unchanged row → same SourceRecord;
- insertion между стабильными anchors → новый SourceRecord;
- deletion → SourceRecord state `MISSING`;
- одиночное изменение между однозначными anchors → revision same SourceRecord.

### Ambiguous cases

- сложный block replacement;
- массовый reorder;
- структурное изменение типа;
- несколько потенциально одинаковых matches.

Такие участки fail-closed → `AMBIGUOUS`/`REVIEW_REQUIRED`.

### 8.1. Incremental lineage counters

Incremental sync всегда строит lineage относительно **последнего COMMITTED** snapshot; `row_hint` остаётся locator, а не identity. Новый `SourceRecord.id` для доказанного `INSERTED` observation задаётся только explicit assignment после sequence diff: migration engine не генерирует identity из row number, digest или similarity.

MigrationRun counters для incremental lineage имеют следующую deterministic семантику:

- `rows_seen` = число observations в текущем full snapshot;
- `rows_new` = число diff outcomes `INSERTED`, которым выдан explicit новый SourceRecord ID;
- `rows_changed` = число доказанных one-to-one `REVISED` outcomes;
- `rows_missing` = число explicit `MISSING` outcomes, доказанных sequence diff;
- `rows_ambiguous` = число **current-side row hints** во всех `AMBIGUOUS_BLOCK` outcomes.

Previous-side SourceRecords внутри `AMBIGUOUS_BLOCK` не считаются автоматически `MISSING` или `CHANGED`, а current-side rows такого блока не получают guessed SourceRecord IDs. Они остаются unresolved evidence до deterministic resolution. Поэтому `rows_ambiguous` — counter текущих неоднозначно сопоставленных observations, а не сумма обеих сторон ambiguous block.

Для unchanged full snapshot сохраняется `rows_seen`, а `rows_new = rows_changed = rows_missing = rows_ambiguous = 0`. Explicit assignments обязаны точно покрывать только доказанные `INSERTED` rows; missing/extra/duplicate assignments или collision с существующим SourceRecord ID блокируют incremental plan до persistence.

## 9. Change classes

### WORKFLOW_TRANSFORM

Известны legacy cleanup pairs:

- `Вика: Да → blank`;
- `Карта Credit → Карта Visa`;
- `Наличка → Карта Visa`.

Но пара значений сама по себе **не доказывает** workflow cleanup. Та же пара может быть owner correction.

Automatic `WORKFLOW_TRANSFORM` разрешён только если одновременно доказан close context:

1. есть successful observation/snapshot **до** cleanup;
2. операция принадлежит только что закрытому legacy period либо была в pre-close working set;
3. обнаружен фактический close event/набор `LEGACY_PERIOD_CLOSE` markers;
4. изменение наблюдается после close;
5. changed fields являются подмножеством known cleanup fields;
6. batch/pattern совместим с legacy cleanup.

Если predicate не доказан — это `OWNER_CORRECTION` или fail-closed `AMBIGUOUS_CHANGE`, но не sticky preservation.

### OWNER_CORRECTION

Обычная содержательная правка:

- amount;
- category;
- occurred_on;
- description;
- note;
- income category;
- account/member change вне доказанного cleanup context.

Canonical Transaction обновляется, `version += 1`.

### AMBIGUOUS_CHANGE

- EXPENSE↔INCOME;
- positive amount→0;
- transaction→non-transaction;
- сложная перестройка row block;
- исчезновение source row;
- конфликт correction vs cleanup context.

Canonical history автоматически не уничтожается.

## 10. Sticky observed facts

Если YDB успел наблюсти исходные `Вика=Да`, `Карта Credit` или `Наличка` **и позже доказан WORKFLOW_TRANSFORM по close-context predicate**, cleanup не должен удалять эти сведения из canonical Transaction.

Это не делает YDB новой authority для всех полей: Google остаётся authoritative для обычных owner corrections.

## 11. Ограничение исторического восстановления

Старые cleanup transformations, произошедшие до первого shadow observation, могут быть невосстановимы.

Не угадывать:

- кто был плательщиком Credit-операции;
- какой account был до старого Credit/Cash→Visa cleanup.

Помечать provenance/data quality как unknown, если необходимо.

## 11.1. Historical granularity/date-quality classification

До normal Transaction analytics importer классифицирует качество legacy record:

```text
record_granularity = TRANSACTION | PERIOD_AGGREGATE | UNKNOWN
date_precision = DAY | MONTH | UNKNOWN
aggregate_period_month?
```

R0 обязан начать с read-only source-classification spike: проверить source schema/vocabulary, выбрать representative windows старой/переходной/современной истории и только после этого зафиксировать deterministic rules + synthetic fixtures. Правила не выводятся из суммы, «круглости», `00:00`, совпадения description/category или других слабых эвристик по отдельности.

Reference `Расход/Доход` может использоваться как oracle для monthly totals, но никогда как источник новых Transactions.

Запрещено hardcode'ить historical cutoff только по визуальному впечатлению. Если classifier не может доказать более точную семантику, используется `UNKNOWN`.

Overlap candidate определяется детерминированно: существует `PERIOD_AGGREGATE` для `(kind, category, aggregate_period_month)` и item-level records того же kind/category с `occurred_on` внутри covered month. Это только detection rule, а не доказательство replacement/additive semantics.

Если такой overlap потенциально существует, records нельзя автоматически суммировать вместе. Classifier обязан доказать additive/replacement semantics; иначе конфликт получает `AMBIGUOUS_OVERLAP`, а метрика, требующая additive certainty, считается недоказанной вместо двойного аналитического total.

Для legacy Google `captured_at` по умолчанию не восстанавливается: raw source datetime остаётся в revision payload; canonical `captured_at=null`, если нет отдельного доказуемого capture timestamp.

## 12. Expense normalization

Legacy EXPENSE (`operation_type=Расход`):

- account ← `expense_account` (physical C);
- category ← `expense_category` (D);
- description ← `description` (E);
- amount ← `expense_amount` (F);
- paid_by_member ← `Вика`, только если `vika_flag=Да`; blank → null/unknown.

Canonical:

```text
type=EXPENSE
from_account_id=...
to_account_id=null
```

## 13. Income normalization

Legacy INCOME (`operation_type=Доход`):

- to account ← `income_account` (physical G);
- category ← `income_category` / legacy `Источник` (H);
- amount ← `income_amount` (I);
- description ← deterministic legacy text-field resolver using only documented source fields.

`Источник` трактуется как income category.

## 13.1. Legacy TRANSFER

В текущем source нет доказанного отдельного legacy `operation_type=TRANSFER`.

Importer **не синтезирует TRANSFER** из пары EXPENSE/INCOME, совпадающих сумм, account cleanup или приблизительно совпадающих дат.

Canonical `TRANSFER` используется:

- в synthetic/domain tests;
- для новых PWA operations;
- для будущей явной migration/reconstruction только если появится отдельный доказанный source contract.

## 13.2. Reference resolver bootstrap

Importer не использует fuzzy entity matching.

Bootstrap keys:

```text
Category → (kind, normalized_source_label)
Account  → (normalized_source_label, RUB)
FamilyMember Вика → explicit vika_flag mapping
```

IDs после создания стабильны и не зависят от будущего display rename. Неизвестный account/category vocabulary не получает invented alias; он идёт в fail-closed review/source-vocabulary update.


## 14. Zero rows

`amount=0` никогда автоматически не создаёт normal Transaction.

`LEGACY_PERIOD_CLOSE` разрешён только по доказанному physical source predicate + close-marker cluster/context из `SOURCE_ADAPTER_CONTRACT`/R0 evidence. Description-like label сам по себе недостаточен: live source содержит spelling/placement variants.

Other or unproven zero rows → `NON_FINANCIAL` или `AMBIGUOUS`.

## 15. `Не учитывать`

Явный нормализованный note `Не учитывать` должен приводить к сохранению операции, но:

`analytics_state=EXCLUDED`.

Не удалять финансовый факт физически.

## 16. Duplicates

Exact duplicates не удаляются автоматически.

Каждая source row имеет независимую provenance lineage.

Допустима только `possible_duplicate` диагностика.

## 17. Delete semantics

Source row disappeared:

- `SourceRecord.state=MISSING`;
- canonical Transaction не hard-delete;
- reconciliation показывает review item;
- требуется осознанное resolution.

Минимальные resolution codes:

```text
KEEP_CANONICAL
VOID_CANONICAL_CONFIRMED
RELINK_SOURCE
ACCEPT_SOURCE_CORRECTION
RESOLVED_NO_CHANGE
```

Resolution сохраняет `resolved_at`, `resolved_by`, `resolution_code`; после resolution mismatch не должен бесконечно считаться unexplained.

### 17.1. Resolution decision vs mechanical effect

`resolution_code` фиксирует уже принятое осознанное решение. Migration engine не имеет права выводить нужный code автоматически только из `MISSING`/`AMBIGUOUS`, similarity, суммы, позиции строки или предполагаемой intent владельца. Если semantic applicability конкретного code не доказана отдельным правилом/context, решение остаётся review-required.

После выбора code mechanical planner обязан быть fail-closed и не выполнять identity inference:

- `KEEP_CANONICAL` — no Transaction mutation; требуется уже существующая exact `transaction_id` link;
- `RESOLVED_NO_CHANGE` — no Transaction/source-link mutation;
- `VOID_CANONICAL_CONFIRMED` — target только текущая exact linked Transaction и явный optimistic `expectedTransactionVersion`; hard delete запрещён;
- `RELINK_SOURCE` — target задаётся только explicit `targetTransactionId`, а source mutation защищена явным `expectedSourceRevision`; fuzzy/nearest/content matching запрещён;
- `ACCEPT_SOURCE_CORRECTION` — target только текущая exact linked Transaction, correction передаётся как explicit canonical candidate, проходит обычный domain validation с явным category context и защищена `expectedTransactionVersion`;
- invalid/missing UUID, version, source revision или invalid canonical candidate блокируют plan до persistence;
- planner не создаёт новую Transaction identity и не выбирает target по source payload;
- applicability code к конкретному `MISSING`/`AMBIGUOUS` case остаётся semantic decision/reconciliation concern, пока отдельное normative rule не доказано.

Effect plan и audit metadata — разные части одного resolution workflow: будущий conditional executor обязан применять effect с optimistic/lost-update guards и сохранять тот же chosen `resolution_code`; успешная запись metadata сама по себе не доказывает, что effectful Transaction/source-link mutation была выполнена.

### 17.2. Incremental review materialization

Incremental review различает **identified SourceRecord ambiguity** и **unresolved lineage**. Это не взаимозаменяемые состояния.

Для SourceRecord, identity которого уже доказана sequence reconciliation:

- `REVIEW_REQUIRED` из contextual classification drift, semantic transition или `AMBIGUOUS_CHANGE` материализуется как `SourceRecord.classification=AMBIGUOUS`, `SourceRecord.state=null`;
- existing exact `transaction_id`, если он уже есть, сохраняется; review не имеет права автоматически unlink/void/replace canonical Transaction;
- новый `INSERTED` SourceRecord с доказанной identity, но ambiguous financial/source semantics, также материализуется `classification=AMBIGUOUS`, `state=null`, без invented `transaction_id`;
- disappearance уже идентифицированного SourceRecord материализуется отдельно: `state=MISSING`, previous classification и exact transaction link сохраняются;
- `normalization_status` **не** используется как скрытый `REVIEW_REQUIRED` flag; до отдельного vocabulary contract он остаётся существующим значением/null.

Current-side rows из `AMBIGUOUS_BLOCK`, которым deterministic sequence reconciliation не может выдать SourceRecord identity, не превращаются в `classification=AMBIGUOUS` с guessed ID. Пока не существует отдельного durable row-level unresolved-lineage persistence/resolution contract, наличие хотя бы одной такой observation блокирует verified-current promotion (`UNRESOLVED_LINEAGE`): candidate/reconciliation evidence может быть построен, но run не становится COMMITTED shadow state.

`resolution_code/resolved_at/resolved_by` относятся к уже завершённому owner resolution текущего review epoch. Новый review reason поверх non-null resolution audit нельзя молча открыть очисткой или overwrite этих полей: до отдельного rollover/history contract такой case fail-closed (`RESOLUTION_EPOCH_ROLLOVER_REQUIRED`). Это сохраняет owner audit и не выдаёт stale resolution за решение новой ambiguity.

## 18. MigrationRun и atomic promotion

```text
MigrationRun

id
started_at
finished_at
source_snapshot_digest
state:
  STAGING | VALIDATED | COMMITTED | FAILED
rows_seen
rows_new
rows_changed
rows_missing
rows_ambiguous
error_code?
```

Invariant:

> `FAILED` run не может изменить observable verified shadow state.

### Initial bootstrap claim and resume identity

Initial bootstrap до любых verified-current mutations обязан сначала закрепить durable writer identity и все уже принятые row identity decisions.

Минимальный протокол:

1. один serializable YDB claim атомарно проверяет отсутствие другого `STAGING/VALIDATED` run и отсутствие уже существующего `COMMITTED` bootstrap baseline;
2. exact `source_snapshots` row, `migration_runs(STAGING)` row и run-scoped `initial_bootstrap_identity_manifests` row создаются в этой же transaction через non-overwriting `INSERT` и exact read-back;
3. identity manifest связывает immutable source observation evidence `(migration_run_id, source_snapshot_id, source_snapshot_digest, source_ordinal, row_hint, row_digest)` с explicit `SourceRecord.id` и, только когда transaction semantics уже доказана, с explicit `Transaction.id`;
4. `source_ordinal`, `row_hint`, digest, similarity и payload content не являются генераторами ID; IDs задаются explicit allocation и после durable claim не переаллоцируются для того же run;
5. resume разрешён только для того же `STAGING/VALIDATED` run и только при exact совпадении manifest с тем же immutable source observation evidence; mismatch, malformed/duplicate binding или contradictory provider evidence переводят выполнение в recovery-required boundary без current-state mutation;
6. initial `SourceRecordRevision(revision=1)` является append-only evidence: persistence использует `INSERT`, а retry сначала читает уже materialized revision-1 rows этого run, exact-сверяет identity/row/payload evidence и пишет только отсутствующие revisions;
7. существующая exact revision-1 не переписывается `UPSERT`-ом и не заменяется новым `SourceRecord.id`, digest или payload решением; extra/duplicate/contradictory revision evidence fail-closed;
8. durable identity manifest является operational resume evidence, а не второй financial authority: Google observation остаётся authoritative, а Reader по-прежнему видит verified shadow только через `COMMITTED` current state.

### Controlled rebuild scheme outcome recovery

`copyTables`/`renameTables` в controlled initial rebuild являются отдельными provider scheme mutations. Timeout, `UNDETERMINED` или RPC ambiguity после отправки mutation **не** означают ни success, ни failure и не разрешают blind retry.

После `SCHEME_OPERATION_OUTCOME_UNKNOWN` runtime использует только read-only evidence и возвращает один из verdict:

- `APPLIED` — exact ожидаемый post-mutation state доказан;
- `NOT_APPLIED` — exact pre-mutation state доказан;
- `RECOVERY_REQUIRED` — evidence mixed/partial/foreign, content не совпадает, read itself не доказан или outcome иначе неоднозначен.

Для initial copy discriminator обязан проверить exact canonical `transactions` + `source_records`, exact run-scoped staging directory/table pair и privacy-safe current/staging reconciliation evidence. Поскольку initial copy создаёт staging из доказанно пустого canonical current state, обе staging tables с table-kind и exact empty evidence доказывают `APPLIED`; обе доказанно отсутствуют при неизменном empty current — `NOT_APPLIED`. Одна таблица, wrong kind, foreign child либо non-empty/divergent evidence → `RECOVERY_REQUIRED`.

Для atomic rename discriminator использует тот же exact run-scoped pair. `APPLIED` допустим только если staging pair доказанно исчез и canonical current exact-сверен с validated candidate. `NOT_APPLIED` допустим только если canonical current всё ещё exact pre-swap empty state, staging pair полностью существует и staging reconciliation exact-сверена с тем же candidate. Любой mixed pair/content mismatch → `RECOVERY_REQUIRED`.

Scheme existence evidence получается через read-only directory/path inspection; provider read error никогда не трактуется как доказательство отсутствия объекта. Recovery path не вызывает `copyTables`, `renameTables` или другую scheme mutation.

После доказанного atomic rename `COMMITTED` marker остаётся отдельной data-transaction boundary, но marker нельзя записать по generic reconciliation evidence. Перед `VALIDATED → COMMITTED` runtime обязан заново получить read-only post-swap proof для **того же** `runId` и **того же** validated candidate: canonical `transactions` + `source_records` должны дать exact `APPLIED` verdict controlled rename discriminator. `NOT_APPLIED`, mixed/foreign structure, content mismatch, provider read failure или run/candidate mismatch блокируют marker как `RECOVERY_REQUIRED`; повторный `renameTables` из marker path запрещён.

Marker recovery возвращает только `COMMITTED | SWAP_APPLIED_MARKER_PENDING | RECOVERY_REQUIRED`. `SWAP_APPLIED_MARKER_PENDING` допустим только для durable unfinished `VALIDATED` row при exact post-swap canonical proof; это recoverable intermediate boundary, а не verified shadow. `COMMITTED` считается доказанным только при exact post-swap proof и exact durable `COMMITTED` marker с ожидаемым lifecycle evidence. `FAILED`, conflicting/malformed marker evidence или canonical mismatch дают `RECOVERY_REQUIRED`. Recovery выполняет только reads и никогда не повторяет scheme mutation. Reader и verified-shadow semantics по-прежнему признают verified только последний durable `COMMITTED` run.

Reader перед canonical `transactions` read обязан получить durable migration-run admission evidence. Если durable `COMMITTED` baseline отсутствует — включая initial `STAGING/VALIDATED` и post-swap `SWAP_APPLIED_MARKER_PENDING` — canonical rows не читаются и Reader fail-closed. Malformed/unreadable admission evidence также fail-closed. После появления хотя бы одного durable `COMMITTED` baseline ordinary incremental `STAGING/VALIDATED` сам по себе не инвалидирует последний verified shadow: ordinary incremental current mutation и новый `COMMITTED` marker выполняются одной atomic YDB transaction, поэтому Reader может продолжать читать last COMMITTED current state до её commit.

Протокол ordinary incremental promotion:

1. full source snapshot читается и candidate canonical projection строится **до** mutation current state;
2. candidate проходит classification и pre-promotion reconciliation/validation по независимому evidence, описанному в §19;
3. вычисляется delta относительно last COMMITTED state;
4. после отсутствия blockers run может перейти `STAGING → VALIDATED`; `VALIDATED` означает разрешение на atomic promotion и **не** означает, что post-change current rows уже materialized;
5. ordinary delta применяется одной атомарной YDB read-write transaction вместе с commit marker; exact previous YDB state защищается verified current readers и optimistic predicates внутри этой transaction;
6. expected post-change candidate не сравнивается с pre-promotion current rows как будто delta уже записан;
7. safe promotion limit определяется отдельным R1 spike по актуальным YDB limits/latency;
8. если delta превышает safe limit, текущий state не меняется, run получает `FAILED/PROMOTION_TOO_LARGE`;
9. большой bootstrap/rebuild выполняется отдельным controlled staging/rebuild path с materialized staging reconciliation и явным promotion, а не partial batch overwrite current state;
10. post-commit current-state read-back/reconciliation является отдельной verification/recovery boundary: mismatch не делает частично проверенный state новым verified shadow и требует recovery/incident handling.

Ordinary incremental sync не получает отдельные staging tables только ради reconciliation. In-memory candidate/delta + independent pre-promotion evidence + atomic guarded promotion остаются canonical path.

`source_record_revisions` могут записываться append-only в staging/evidence path, но ни одна revision failed run не должна заставить Reader считать candidate verified current state.

Только последний COMMITTED run считается verified shadow.

## 19. Reconciliation gate

Reconciliation имеет разные materialization boundaries для controlled rebuild и ordinary incremental sync.

### Controlled bootstrap/rebuild

Expected candidate сравнивается с **materialized YDB staging evidence** до явного staging promotion. Staging reconciliation обязана доказать, что materialized staging state соответствует candidate в пределах перечисленных ниже invariant/aggregate checks.

### Ordinary incremental atomic delta

До atomic promotion expected post-change snapshot **не** сравнивается с pre-promotion YDB current rows: при реальном delta они по определению различаются. Ordinary incremental pre-promotion reconciliation имеет две distinct construction paths поверх одного canonical financial semantics pipeline.

#### Expected path

Expected reconciliation snapshot строится из полного post-change candidate current state после deterministic lineage/semantic/candidate preparation. Этот snapshot выражает то состояние, которое run собирается materialize после atomic delta.

#### Independent roll-forward path

Observed-for-validation snapshot не читается как несуществующий future YDB state и не строится повторным обходом full candidate. Он механически рассчитывается из:

1. exact verified baseline `SourceRecord` rows и canonical Transactions, прочитанных согласованно с exact last `COMMITTED` MigrationRun;
2. prepared `sourceIntents` и `transactionIntents`, рассчитанных из того же leased authoritative observation относительно этого exact baseline;
3. explicit optimistic preconditions, уже присутствующих в delta intents.

Mechanical roll-forward правила:

- baseline entity без delta intent сохраняется без изменения;
- `CREATE_SOURCE_RECORD` / `CREATE_TRANSACTION` добавляют ровно payload соответствующего intent;
- `UPDATE_SOURCE_RECORD` заменяет только exact baseline SourceRecord identity и только при совпадении всех declared previous-state guards (`expectedCurrentRevision`, digest/state/link/resolution predicates и применимых immutable identity facts);
- `REPLACE_TRANSACTION` заменяет только exact baseline Transaction identity и только при совпадении `expectedVersion` и применимых identity facts;
- duplicate intent, missing target, target collision, predicate mismatch, malformed baseline/candidate payload, unsupported operation или implicit delete → construction failure; такой run не получает reconciliation `MATCHED`;
- roll-forward projector не выполняет source classification, fuzzy mapping, entity resolution, normalization или financial inference и не создаёт новые identities;
- после replay итоговый in-memory set агрегируется тем же reconciliation vocabulary, но без чтения full candidate arrays.

Эта independence является **construction independence**, а не второй financial authority. Google observation остаётся authoritative source, canonical normalizer остаётся единственным financial semantics engine. Цель второго path — доказать, что exact verified baseline + prepared mutation intents механически приводят к тому aggregate state, который заявляет independently constructed full candidate snapshot. Это обнаруживает omission/extra/divergence между candidate и write intent без materialized staging и без второго analytics/normalization engine.

#### Comparison and fail-closed result

Expected snapshot и roll-forward snapshot сравниваются exact по существующим checks. `MATCHED` разрешён только при точном совпадении соответствующего invariant/aggregate set. Для допуска к `VALIDATED`:

- все reconciliation checks должны быть `MATCHED`;
- `NOT_CHECKED` не является success;
- construction failure не конвертируется в `MATCHED` и блокирует lifecycle до promotion;
- mismatch count отражает реальные mismatched checks; hardcoded/synthetic `MATCHED` в production path запрещён;
- exact source-observation coverage, unresolved-lineage blockers, run counters и candidate/delta internal consistency остаются отдельными validation guards и не заменяются aggregate reconciliation;
- optimistic predicates повторно защищают exact previous provider state внутри atomic promotion transaction, поэтому успешный pre-promotion roll-forward не отменяет lost-update protection.

Самосравнение `expected candidate` с тем же in-memory candidate не считается reconciliation evidence. Прямое сравнение expected post-change snapshot с pre-promotion CURRENT также не считается reconciliation evidence.

После успешного atomic commit runtime может выполнить отдельный post-commit current-state read-back и сравнить committed state с promoted candidate. Любой mismatch переводит выполнение в recovery/incident boundary; он не должен превращать failed/сомнительный run в partially verified shadow state.

Минимальный reconciliation vocabulary, применимый к materialized staging, roll-forward либо post-commit evidence в соответствующей boundary:

- SourceRecord count;
- EXPENSE/INCOME counts;
- totals by type;
- totals/counts by category;
- totals/counts by account;
- counts by classification;
- LEGACY_PERIOD_CLOSE;
- INVALID/AMBIGUOUS/MISSING.

Operational/public evidence содержит только privacy-safe statuses/counts. Private totals, descriptions, raw payload и private aggregate values не публиковать в GitHub/log evidence.

## 20. Pre-close protection

До старого ручного cleanup должен существовать successful snapshot, иначе могут потеряться Credit/Cash/Vika semantics.

В transition phase полезно иметь:

- sync несколько раз в день;
- owner-facing `Последняя синхронизация`;
- pre-close verification;
- alarm `PERIOD_PRE_CLOSE_SNAPSHOT_MISSING`, если legacy close markers появились без доказанного snapshot до cleanup.

## 20.1. Financial-period assignment during migration

`financial_period_id` — first-class domain field, но production `financial_periods` появляются только в R4.

Поэтому в R0/R1/R2 для imported legacy Transactions:

```text
financial_period_id = null
period_assignment_quality = UNASSIGNED
```

Importer/reconciliation может собирать **неперсистентное assignment evidence** по legacy close boundaries для будущего R4 bootstrap, но не создаёт ссылки на отсутствующие period rows.

В R4:

- создаются реальные `financial_periods`;
- однозначные legacy records могут быть backfill'нуты с `DERIVED`;
- спорные same-day records остаются `LEGACY_AMBIGUOUS`/`UNASSIGNED`;
- новые authoritative PWA writes после cutover получают `EXPLICIT` membership current OPEN period.

`LegacyCurrentPeriodProjection` в R2 — provisional read model, не canonical `financial_period_id`.

## 21. Authority stages

### SHADOW_BOOTSTRAP

Initial import.

### SHADOW_SYNCING

Regular replication.

### SHADOW_STABLE

Несколько последовательных reconciliation без unexplained mismatches.

### READ_ELIGIBLE

PWA может читать YDB, Google всё ещё authority/fallback.

### CUTOVER_CANDIDATE

Можно обсуждать YDB-authoritative product/Writer writes. До этого Writer UX/API разрешено разрабатывать только в synthetic/test/private pilot namespace; production financial `YDB_WRITE_ENABLED=false`. R1 shadow/migration writes в YDB при этом разрешены только через этот migration contract и не меняют authority: Google остаётся единственной write authority.

## 22. READ_ELIGIBLE minimum

Нужно доказать минимум один полный реальный расчётный цикл, включая:

- новые операции;
- Credit;
- Cash;
- Вика;
- owner corrections;
- close markers;
- post-close cleanup;
- preservation of sticky facts;
- reconciliation.

## 23. Future write cutover

YDB authoritative только после explicit CUTOVER GATE:

- нескольких доказанных real shadow cycles;
- offline outbox/conflict tests;
- idempotent writes;
- tested reverse Google compatibility mirror;
- tested restore/fallback;
- owner usage of YDB read path;
- отсутствия unresolved high-impact ambiguity;
- доказанного PeriodClose bootstrap/period-membership contract;
- owner approval authority switch.

Только после gate production `YDB_WRITE_ENABLED=true`; до этого Google остаётся единственной write authority.

## 23.1. Reverse mirror loop prevention

Перед Stage D compatibility exporter должен доказать loop-safe projection в тот же legacy sheet.

Минимальный контракт:

1. YDB-authored Transaction имеет стабильный canonical `transaction_id`;
2. exporter записывает его в зарезервированное техническое Google metadata field (например `prih_rash_id`; фактическое имя/позиция проверяются на compatibility spike);
3. при update может храниться `prih_rash_revision`;
4. importer видит известный marker и выполняет reconciliation/ack, **не создавая новый Transaction**;
5. Google Form/legacy row без marker остаётся genuine source candidate;
6. row number/content digest не используются как loop-prevention identity;
7. metadata columns можно добавлять только после теста, что они не ломают Google Form и reference formulas;
8. unmarked новая Google Form row после cutover может быть fallback input только при явно включённом compatibility mode: importer создаёт canonical Transaction и exporter возвращает marker;
9. ручная правка уже marked mirror row после YDB-authoritative cutover **не переписывает YDB автоматически** — это `GOOGLE_MIRROR_DRIFT` для review, потому что authority уже YDB.

Если loop-safe marker нельзя внедрить без нарушения legacy workflow, Stage D блокируется до другого доказанного compatibility mechanism.

## 24. Prohibited migration behavior

Migration engine никогда автоматически не:

- пишет в Google;
- исправляет source rows;
- объединяет похожие операции;
- удаляет exact duplicates;
- переименовывает taxonomy;
- угадывает плательщика;
- превращает loan draw в income;
- превращает repayment в expense;
- импортирует monthly-close marker как Transaction;
- переписывает ambiguous history ради PASS.