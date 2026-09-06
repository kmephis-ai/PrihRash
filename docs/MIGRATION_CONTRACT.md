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

### Raw payload schema v1

`raw_payload` — приватный diagnostic/provenance payload с **всеми 11 source fields**, но через stable adapter keys:

```json
{
  "adapter_schema_version": 1,
  "date": null,
  "operation_type": null,
  "expense_account": null,
  "expense_category": null,
  "description": null,
  "expense_amount": null,
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
- string values сохраняются как source text после только технически безопасной Unicode/line-ending normalization;
- numeric values сериализуются детерминированно без binary-float round-trip;
- source date/datetime сохраняется в однозначном technical representation;
- payload никогда не публикуется в GitHub/log evidence;
- изменение physical source schema требует нового `adapter_schema_version`, а не тихого переиспользования старого payload contract.


## 6. Raw digest

Deterministic digest строится из нормализованного технического представления всех source columns.

Нормализация допускает только стабильное представление пустых значений, чисел, дат, line endings и Unicode.

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

Протокол:

1. full source snapshot читается и candidate canonical projection строится **до** mutation current state;
2. candidate проходит classification + reconciliation;
3. вычисляется delta относительно last COMMITTED state;
4. обычный delta применяется одной атомарной YDB read-write transaction вместе с commit marker;
5. safe promotion limit определяется отдельным R1 spike по актуальным YDB limits/latency;
6. если delta превышает safe limit, текущий state не меняется, run получает `FAILED/PROMOTION_TOO_LARGE`;
7. большой bootstrap/rebuild выполняется отдельным controlled staging/rebuild path с явным promotion, а не partial batch overwrite current state.

`source_record_revisions` могут записываться append-only в staging/evidence path, но ни одна revision failed run не должна заставить Reader считать candidate verified current state.

Только последний COMMITTED run считается verified shadow.

## 19. Reconciliation gate

После normalizer сравнивать expected canonical projection с YDB current state.

Минимум:

- SourceRecord count;
- EXPENSE/INCOME counts;
- totals by type;
- totals/counts by category;
- totals/counts by account;
- counts by classification;
- LEGACY_PERIOD_CLOSE;
- INVALID/AMBIGUOUS/MISSING.

Private totals не публиковать в GitHub evidence.

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

PWA может читать YDB, Google всё ещё authority.

### CUTOVER_CANDIDATE

Можно обсуждать production YDB writes. До этого Writer UX/API разрешено разрабатывать только в synthetic/test/private pilot namespace; production financial `YDB_WRITE_ENABLED=false`.

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
