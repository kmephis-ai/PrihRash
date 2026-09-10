# R3A Writer create/idempotency contract

Status: R3A synthetic/test application contract. Он **не** является production HTTP/YDB deployment contract и не меняет authority: до отдельного доказанного cutover остаётся `Google authoritative → YDB shadow`, production `YDB_WRITE_ENABLED=false`.

## Цель текущего среза

Минимально доказать create/idempotency semantics по типам без premature universal API: repeated create одного и того же manual EXPENSE или INCOME не должен порождать вторую Transaction. EXPENSE и INCOME пока имеют отдельные type-specific application contracts; общий create framework не вводится без доказанной необходимости.

Контракты transport-independent. HTTP route, OWNER auth binding, YDB persistence schema и browser sync worker добавляются отдельными work items после доказанного application behavior.

## Create EXPENSE v1

`WRITER_CREATE_CONTRACT_VERSION = 1`.

Request:

```text
idempotencyKey  canonical lowercase UUID
occurredOn      valid full YYYY-MM-DD
amountMinor     positive safe integer
currency        RUB
fromAccountId   canonical lowercase UUID
categoryId      canonical lowercase UUID
description     null | non-empty already-trimmed text
note            null | non-empty already-trimmed text
```

`idempotencyKey` может быть существующим preview `intentId`, но **не является** canonical Transaction id. Transaction id создаётся отдельно.

Unknown fields и malformed lexical evidence fail-closed как `INVALID_REQUEST`. Никакой normalization, fuzzy reference matching или inference нет.

## Public create API envelope v1

`expenseCreateApi.ts` добавляет только framework/provider-neutral API projection поверх `executeIdempotentExpenseCreate()`. Он не повторяет request parsing, reference resolution, FIN-TRUTH или idempotency semantics.

Успешный публичный response намеренно минимален:

```text
{
  apiVersion: 1,
  outcome: CREATED | REPLAY,
  idempotencyKey: canonical lowercase UUID,
  transactionId: canonical lowercase UUID,
  version: 1
}
```

`transactionId` — canonical identity созданной Transaction и не равен `idempotencyKey`. Exact replay возвращает ту же `transactionId/version`, что и первый create.

Envelope **не** возвращает full `CanonicalTransaction`, amount/date, account/category ids или labels, description/note, reference evidence, storage/provider diagnostics. Browser outbox для подтверждения доставки должен нуждаться только в stable identity/outcome, а не получать второй financial payload через acknowledgement.

Ошибки не переводятся в новый параллельный vocabulary: наружу остаются stable value-free `ExpenseCreateError.code` из application contract ниже. HTTP status/body wrapping, route path, headers, CORS, cookie/session verification и API Gateway/private Function binding этим срезом не определяются. Real OWNER/provider wiring всё ещё разрешается только после canonical R1 readiness #302 и fresh provider discovery.

## Reference evidence

Для **нового** create после idempotency miss application dependency должна вернуть exact evidence для requested account/category ids. Missing evidence → `REFERENCE_NOT_FOUND`; malformed/лишние поля или возвращённые другие ids → `REFERENCE_MISMATCH`; category kind, отличный от `EXPENSE`, → `CATEGORY_KIND_INVALID`. Dependency exception санитизируется в `REFERENCE_READ_FAILED` без provider diagnostics.

Уже committed replay не зависит от текущего mutable reference state: если `readCommitted(idempotencyKey)` вернул исходный request/result и request совпадает exact, application возвращает replay без повторного account/category lookup и без генерации новой Transaction identity. Это нужно, чтобы безопасный retry не ломался только потому, что reference позже был скрыт/изменён. Stored request/result при этом всё равно проходят fail-closed contract validation.

Эта dependency boundary намеренно не определяет provider query/YDB implementation.

## Canonical transaction projection

Для доказанного new manual EXPENSE application строит одну canonical Transaction через существующий FIN-TRUTH validator:

```text
type                    EXPENSE
recordGranularity       TRANSACTION
datePrecision           DAY
aggregatePeriodMonth    null
financialPeriodId       null
periodAssignmentQuality UNASSIGNED
currency                RUB
toAccountId             null
paidByMemberId          null
status                  POSTED
analyticsState          INCLUDED
flowKind                null
version                 1 (create result envelope)
```

`occurredOn`, `amountMinor`, `fromAccountId`, `categoryId`, `description`, `note` приходят из canonical request. Результат обязан пройти `validateTransaction(..., { categoryKind: 'EXPENSE' })`.

## Idempotency store port

Port состоит из двух операций с разными ролями:

1. `readCommitted(idempotencyKey)` — безопасный pre-read уже committed request/result. Exact same request возвращается как `REPLAY` без current reference lookup и без генерации новой Transaction identity. Different request для того же key → `IDEMPOTENCY_CONFLICT`. Miss продолжает create path.
2. `createOrReplay({ request, candidate })` — **atomic race-closure** после pre-read miss и reference validation. Между pre-read и commit другой caller мог уже использовать key, поэтому store обязан атомарно вернуть один из трёх исходов.

Atomic `createOrReplay` outcomes:

- `CREATED`: key ещё не встречался; commit одной candidate Transaction и original request/result;
- `REPLAY`: тот же key уже committed конкурентно с **exact same canonical structured request**; вернуть original request/result без второго create;
- `CONFLICT`: тот же key уже committed с другим canonical request; ничего не менять.

`CONFLICT` application переводит в `IDEMPOTENCY_CONFLICT`. Pre-read является optimization/correctness path для стабильного replay, но **не заменяет** атомарность `createOrReplay` и не используется как check-then-insert guarantee.

Application дополнительно fail-closed проверяет committed/replay/create result: stored request должен точно совпасть, Transaction id должен быть canonical UUID, `version=1`, а canonical transaction — совпасть с canonical request projection и пройти FIN-TRUTH validation. Нарушение port contract → `STORE_CONTRACT_INVALID`.

## Error boundary

Безопасные application codes текущего среза:

- `INVALID_REQUEST`;
- `REFERENCE_NOT_FOUND`;
- `REFERENCE_MISMATCH`;
- `CATEGORY_KIND_INVALID`;
- `REFERENCE_READ_FAILED`;
- `INVALID_GENERATED_TRANSACTION_ID`;
- `IDEMPOTENCY_CONFLICT`;
- `STORE_OPERATION_FAILED`;
- `STORE_CONTRACT_INVALID`.

Они не содержат financial payload или provider diagnostics. Exceptions от reference/store ports не пробрасываются наружу verbatim: transport сможет позже маппить только стабильные safe codes, не зная внутренних provider сообщений.


## Create INCOME v1

`idempotentIncomeCreate.ts` добавляет отдельный type-specific application contract без рефакторинга проверенного EXPENSE path. `WRITER_INCOME_CREATE_CONTRACT_VERSION = 1`.

Request:

```text
idempotencyKey  canonical lowercase UUID
occurredOn      valid full YYYY-MM-DD
amountMinor     positive safe integer
currency        RUB
toAccountId     canonical lowercase UUID
categoryId      canonical lowercase UUID
description     null | non-empty already-trimmed text
note            null | non-empty already-trimmed text
```

Unknown fields и malformed lexical evidence fail-closed как `INVALID_REQUEST`; normalization/fuzzy matching отсутствуют. `idempotencyKey` отделён от canonical Transaction id.

На new-create miss dependency `readIncomeCreateReferenceEvidence({toAccountId, categoryId})` обязана вернуть exact destination account/category evidence. Missing → `REFERENCE_NOT_FOUND`; mismatched/malformed → `REFERENCE_MISMATCH`; category kind, отличный от `INCOME`, → `CATEGORY_KIND_INVALID`; dependency exception → `REFERENCE_READ_FAILED` без raw diagnostics.

Canonical INCOME projection:

```text
type                    INCOME
recordGranularity       TRANSACTION
datePrecision           DAY
aggregatePeriodMonth    null
financialPeriodId       null
periodAssignmentQuality UNASSIGNED
currency                RUB
fromAccountId           null
toAccountId             request.toAccountId
categoryId              request.categoryId
paidByMemberId          null
status                  POSTED
analyticsState          INCLUDED
flowKind                null
version                 1 (create result envelope)
```

Projection проходит существующий `validateTransaction(..., { categoryKind: 'INCOME' })`.

Idempotency semantics совпадают по гарантиям с EXPENSE, но не реализованы через новый universal abstraction: exact committed pre-read → `REPLAY` без current reference lookup/new identity; changed request на том же key → `IDEMPOTENCY_CONFLICT`; atomic `createOrReplay()` закрывает race после miss. Stored request/result и race response валидируются fail-closed против expected INCOME transaction; wrong type/direction/version/payload → `STORE_CONTRACT_INVALID`.

INCOME application использует тот же stable value-free error vocabulary (`INVALID_REQUEST`, reference errors, identity error, `IDEMPOTENCY_CONFLICT`, store errors).

## Public INCOME create API envelope v1

`incomeCreateApi.ts` добавляет только framework/provider-neutral public projection поверх `executeIdempotentIncomeCreate()`. Request parsing, reference resolution, FIN-TRUTH projection и idempotency/store semantics не дублируются.

Успешный response имеет тот же минимальный acknowledgement shape, что и доказанный EXPENSE create API:

```text
{
  apiVersion: 1,
  outcome: CREATED | REPLAY,
  idempotencyKey: canonical lowercase UUID,
  transactionId: canonical lowercase UUID,
  version: 1
}
```

`transactionId` остаётся отдельной canonical Transaction identity и не равен `idempotencyKey`; exact replay возвращает original `transactionId/version` из application contract. Envelope не возвращает full `CanonicalTransaction`, amount/date, destination account/category ids, description/note, reference evidence или store/provider diagnostics.

Ошибки не получают отдельный API vocabulary: наружу проходит существующий stable value-free `IncomeCreateError.code`. Этот слой намеренно не определяет HTTP status/path/body wrapping, headers/CORS, cookie/session verification, browser `fetch`, API Gateway/private Function или YDB/provider binding. Реальный OWNER/provider wiring остаётся за canonical provider gate #302.

Browser INCOME ACK/delete delivery также остаётся отдельным work item: наличие public envelope само по себе не подключает network transport и не меняет authority. Production `YDB_WRITE_ENABLED=false`.

## Non-scope

- HTTP status/body mapping и OWNER session binding;
- YDB idempotency table/transaction implementation;
- outbox POST/retry worker;
- INCOME browser ACK delivery;
- TRANSFER / `paid_by`;
- optimistic edit / VOID;
- Google Form/GAS intake parity;
- production Writer, R4, CUTOVER.
