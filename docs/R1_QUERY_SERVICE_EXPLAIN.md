# R1 QueryService EXPLAIN — граница причинной диагностики

Статус: **code/test only**. Документ не выдаёт provider authority, не меняет
`MIGRATION_CONTRACT`, `R1_COMPLETION_SPRINT` или финансовую семантику.
До cutover: **Google authoritative → YDB shadow**.

## Зачем

У одного live `durable_only=true` чтения два разных варианта реализации завершились
`READ_BUDGET_NOT_PROVEN`. Предыдущий Owner-authorized `ydb sql --explain`
остановился как `COUNT_EXPLAIN_FAILED`; план не был получен. Новый путь не
повторяет SQL-reading experiment: это QueryService `ExecMode.EXPLAIN` без
выполнения финансовых запросов.

## Что реализовано

- `scripts/r1-queryservice-explain-proof.mjs` принимает только точный
  allowlist `COUNT` / `BY_KEY` из существующего guard, создаёт YDB typed
  parameters, запрещает `EXECUTE`, transaction control и result sets.
- Используется один `CreateSession → ExecuteQuery(EXPLAIN) → DeleteSession`
  на каждый запрос; incomplete/malformed/duplicate/oversize plan, transport
  failure и непроверенное закрытие сессии — fail-closed.
- `scripts/r1-durable-revision-guard.mjs` формирует **только синтетические**
  значения для двух существующих SQL-запросов: один фиктивный run UUID и
  128 фиктивных primary keys. Реальные Google/YDB records не читаются.
- `scripts/r1-queryservice-explain-readonly.mjs` — manual-only helper,
  требующий отдельно подтверждённых внешних gates и явного одноразового
  execution marker. Этот marker — технический предохранитель, **не
  самостоятельное разрешение** на IAM/provider call.
- Никаких GitHub Actions dispatch, таймеров, scheduled sync, cutover,
  database writes, schema migrations или Function operations.

## Interpret results, fail closed

| Outcome | Что означает | Следующее действие |
|---|---|---|
| `COUNT_INDEX_READ_OBSERVED` + `BY_KEY_POINT_LOOKUP_OBSERVED` | Структурные операторы в обоих логических планах указывают на индекс/PK | Только независимая оценка стоимости и gate на durable read; **не** COMMITTED |
| `FULL_SCAN_OBSERVED` | В скомпилированном плане присутствует full scan | Пересмотреть алгоритм доказательства, **не** повышать RU cap |
| `PLAN_UNCLASSIFIED` | План есть, но семантика операторов не доказана | STOP; нельзя считать индекс подтверждённым |
| `SESSION_UNAVAILABLE`, `EXPLAIN_REJECTED`, `EXPLAIN_TRANSPORT_UNPROVEN` | Нет проверенной server-side compilation | STOP на соответствующем connection/auth/SQL layer |
| `SESSION_RETIREMENT_UNPROVEN` | Не доказано закрытие сессии | STOP; не публиковать optimistic PASS |

Это **классификация наблюдаемых операторов**, а не оценка фактических RU.
Положительный план не доказывает `COMMITTED(A)`, snapshot identity, полноту
ревизий, Google reconciliation, готовность миграции или бюджет реальных чтений.

## Safety / authority

Никакой live provider invocation не разрешён данным изменением. Для будущего
единичного вызова необходимо отдельное явное Owner решение с точным scope;
перед ним — fresh exact main + CI, active Issue/PR, no conflicting writer,
provider DB RUNNING/cap и independent ACL baseline. Внешний execution wrapper
обязан добавить *только* временную database-scoped `ydb.viewer` роль
для доказанной WIF identity, подтвердить propagation и **всегда** отозвать
своё binding с независимой final ACL проверкой. Unknown grant/revoke outcome
— recovery boundary, без blind retry.

No raw query plan, provider error, SQL parameters, private IDs, rows,
counts, digests or estimated RU in GitHub, Actions, Issues или stdout.
Code-only PR **не** вызывает live YDB, IAM или Google операции.

## Проверка

`npm run build` и
`node --test tests/tooling/r1-queryservice-explain-proof.test.mjs`
покрывают canonical shapes, serialized `ExecMode.EXPLAIN`, synthetic stream,
session lifecycle, refusal of `EXECUTE`, unexpected results, unknown/ambiguous
plans, cleanup failures and no-gate runner refusal. Canonical Node22
`npm run check` + CI required before claiming merged readiness.

**Natural boundary:** provider `EXPLAIN` и вердикт реального YDB планировщика
остаются **NOT_PROVEN** до отдельной разрешённой попытки. R1
`READ_BUDGET_NOT_PROVEN` не устранён этим coding item.
