# Roadmap — clean reboot v1.4

Roadmap намеренно короткий. Он не является многолетним exhaustive plan. Следующий крупный шаг выбирается rolling-wave после фактического результата предыдущего. Calendar-based production gates не запрещают параллельную разработку следующего UX на synthetic/test data.

## R0 — Data Foundation Proven

### Цель

Доказать, что PrihRash правильно понимает реальные данные без YDB и UI и не приписывает старой истории ложную точность.

### Work units

1. Minimal repo skeleton + CI.
2. Canonical domain invariants + RUB-only v1 contract.
3. Read-only verification `SOURCE_ADAPTER_CONTRACT`: 11-column schema, operation/account vocabulary, schema-drift fail-closed.
4. Reference resolver bootstrap contract: Category `(kind,label)`, Account `(label,RUB)`, Vika mapping; no fuzzy aliases.
5. Historical granularity/date-quality spike на private read-only real data → deterministic rules + synthetic fixtures. Слабые эвристики сами по себе запрещены.
6. Synthetic fixtures для EXPENSE/INCOME/TRANSFER domain invariants, zero/service rows, duplicates и legacy anomalies.
7. Expense normalizer.
8. Income normalizer.
9. Legacy period-close classifier.
10. `Не учитывать`/analytics_state.
11. Sequence-diff migration simulator.
12. Contextual WORKFLOW_TRANSFORM vs OWNER_CORRECTION tests.
13. MISSING/AMBIGUOUS resolution contract tests.
14. Independent raw-baseline reconciliation + reference-sheet cross-check на representative coarse/transition/modern windows.

### Exit criteria

- live read-only source schema соответствует `SOURCE_ADAPTER_CONTRACT` либо schema drift явно блокирует normalizer;
- каждая meaningful source row получает явную classification, включая `AMBIGUOUS/INVALID`; silent drop = 0;
- для deterministically normalized comparable INCLUDED EXPENSE/INCOME canonical totals **точно** совпадают в minor units с independent raw baseline по type/category/month/account;
- reference-only sheets используются как cross-check, а не authority: каждый mismatch на выбранных representative windows либо объяснён documented data-quality/reference semantics, либо R0 не PASS;
- coarse historical data never masquerades as daily transactions;
- unknown vocabulary/uncertain granularity fail-closed, а не получают guessed alias/classification;
- no private payload in GitHub;
- cleanup preservation requires close context;
- owner получает понятный safe reconciliation summary.

`AMBIGUOUS=0` не является искусственным требованием: допустима честно классифицированная историческая неопределённость. Недопустим **unexplained** mismatch или silent guessing.

## R1 — YDB Shadow Proven

### Цель

Сделать YDB надёжной shadow-копией без возможности partial failed state.

### Work units

1. Versioned `001_initial` YDB schema + `schema_migrations`.
2. YDB adapter tests.
3. MigrationRun state machine.
4. Atomic promotion spike + safe delta limit.
5. Initial full bootstrap: candidate/evidence persistence + validated promotion route; ordinary atomic promotion используется только если calibrated preflight проходит.
6. Incremental candidate/delta sync.
7. Controlled large rebuild/staging path or explicit fail-closed procedure; если work unit 5 возвращает `CONTROLLED_REBUILD_REQUIRED`, этот work unit является обязательной dependency для verified initial bootstrap promotion.
8. Private reconciliation + resolution actions.
9. Scheduled sync runtime.
10. Pre-close snapshot protection.
11. Cost/latency/cap measurements.

Rolling-wave dependency: candidate/evidence части initial bootstrap могут завершаться до work unit 7, но verified promotion нельзя считать завершённым, пока выбранный calibrated route не доказан. Нельзя расширять ordinary atomic cap для обхода `CONTROLLED_REBUILD_REQUIRED`.

### Exit criteria

R1 bootstrap/incremental `shadow/migration writes` в YDB являются частью shadow replication и не меняют authority: до CUTOVER Google остаётся единственной write authority.

- `FAILED` run не меняет verified shadow;
- минимум один полный real расчётный цикл;
- Credit/Cash/Vika semantics сохранены при доказанном cleanup context;
- unexplained high-impact mismatch отсутствуют;
- Google всё ещё authoritative.

> Пока идёт реальный расчётный цикл, R2/R3A можно разрабатывать на synthetic/test/candidate data. Нельзя обходить production gate, но и нельзя простаивать календарный месяц.

## R2 — Reader

### Цель

Как можно раньше дать владельцу новый видимый продукт.

### Capabilities

- minimal Reader API contract определяется в этом work item (не заранее в Reboot Pack);
- Yandex auth для `OWNER`;
- PWA shell;
- IndexedDB cache;
- recent operations;
- basic filters;
- optional `LegacyCurrentPeriodProjection` с provisional label до R4, только если post-close working set однозначен;
- fast local open;
- graceful offline read;
- honest historical granularity labels.

### Performance gate

Измерить `recent transactions` и date-range queries. Если full scan не укладывается в target, добавить ровно один доказанный index/read projection.

### Exit criteria

- пользователь реально предпочитает Reader сырой таблице для ежедневного просмотра;
- warm experience быстрый;
- YDB read path доказан;
- coarse legacy history не выглядит точнее источника.

## R3A — Writer UX Proven (non-authoritative)

### Цель

Доказать UX и offline-write механику, не меняя production authority.

### Capabilities

- Reader API contract минимально расширяется create/edit/void/idempotency endpoints; полный universal API заранее не проектируется;
- inventory текущего Google Form/GAS intake behavior: validation/defaults/triggers, если они существуют; переносится только доказанная пользовательская семантика, не GAS architecture;
- quick EXPENSE;
- INCOME;
- TRANSFER;
- paid_by member;
- note;
- occurred_on override;
- IndexedDB draft/outbox;
- idempotent create;
- optimistic edit;
- VOID вместо hard delete.

Используется synthetic/test/private pilot namespace. Production `YDB_WRITE_ENABLED=false`.

### Exit criteria

- offline create работает;
- повторный submit не создаёт дубль;
- conflict flow понятен;
- owner UAT подтверждает, что ввод быстрее/понятнее формы.

## R4 — Financial Period / Close

### Цель

Заменить ручной monthly cleanup явным domain workflow до authority cutover.

### Capabilities

- configurable target close day;
- explicit FinancialPeriod membership;
- same-day close/new-operation semantics;
- owner-confirmed legacy bootstrap anchor;
- automatic buckets Credit/Vika/Negative;
- PositivePositions;
- invariant check;
- decomposition/drill-down;
- reminder checklist;
- close confirmation;
- correction/revision of closed period.

### Exit criteria

- несколько периодов совпадают по смыслу с `Месячные`;
- ambiguous legacy boundary records не маскируются как exact;
- после close Transactions не переписываются;
- новый workflow не нуждается в zero-marker cleanup.

## CUTOVER GATE — Stage D

YDB-authoritative product/Writer writes (`YDB_WRITE_ENABLED=true`) разрешаются только после:

- нескольких доказанных real shadow cycles;
- R3A outbox/idempotency/conflict proof;
- tested loop-safe YDB→Google compatibility mirror с stable canonical ID;
- restore/fallback test;
- доказанного PeriodClose bootstrap/membership;
- owner реально использовал Reader;
- unresolved high-impact ambiguity отсутствует;
- owner policy cost limit соблюдён/оценён;
- explicit owner authority approval.

## R3B — Production Writer / YDB authoritative

После CUTOVER GATE:

- production `YDB_WRITE_ENABLED=true`;
- PWA создаёт authoritative Transactions;
- Google получает compatibility mirror;
- rollback to Google-authoritative остаётся проверенным.

## R5 — Familiar-first Analytics

### Цель

Сделать аналитику не хуже текущих `Доход/Расход`, но управляемой и честной по качеству истории.

### Capabilities

- arbitrary period;
- calendar/financial period presets;
- income/expense breakdown;
- shares/averages;
- compare periods;
- drill-down;
- desktop table mode;
- CSV export;
- saved views;
- data-quality aware measures для PERIOD_AGGREGATE.

## R6 — Planning / Obligations

- recurring/one-time obligations;
- variable/unknown amount;
- due dates;
- checklist;
- link plan→fact;
- Plan vs Fact.

## Later

Только после доказанной необходимости:

- QR receipts;
- receipt items/allocation;
- deterministic auto-classification;
- AI proposals;
- richer dashboards;
- OLAP projection;
- external financial integrations.
