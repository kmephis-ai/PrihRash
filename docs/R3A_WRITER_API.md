# R3A Writer application contracts

Status: R3A synthetic/test application contract. Он **не** является production HTTP/YDB deployment contract и не меняет authority: до отдельного доказанного cutover остаётся `Google authoritative → YDB shadow`, production `YDB_WRITE_ENABLED=false`.

## Цель текущего среза

Минимально доказать Writer application semantics небольшими type-specific срезами без premature universal API. Create/idempotency path уже покрывает EXPENSE, INCOME и TRANSFER; optimistic edit начинается отдельно с EXPENSE. Общий Writer framework не вводится без доказанной необходимости.

Контракты transport-independent. HTTP route, OWNER auth binding, YDB persistence schema, browser conflict UI и sync worker добавляются отдельными work items после доказанного application behavior.

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
paidByMemberId  canonical lowercase UUID | null
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

Для **нового** create после idempotency miss application dependency должна вернуть exact evidence для requested account/category и optional member ids. `paidByMemberId` проверяется независимо от `fromAccountId`: payment account не определяет payer и не ограничивает допустимый member. Если payer не выбран, request и evidence содержат `paidByMemberId/memberId=null`; это означает отсутствие выбранного/доказанного payer, а не inference другого member. Для non-null payer reference reader обязан вернуть exact тот же canonical member id; отсутствие/неоднозначность exact member evidence представляется как no exact evidence и fail-closed `REFERENCE_NOT_FOUND`, другой или malformed member id → `REFERENCE_MISMATCH`.

Missing aggregate reference evidence → `REFERENCE_NOT_FOUND`; malformed/лишние поля или возвращённые другие account/category/member ids → `REFERENCE_MISMATCH`; category kind, отличный от `EXPENSE`, → `CATEGORY_KIND_INVALID`. Dependency exception санитизируется в `REFERENCE_READ_FAILED` без provider diagnostics. Никакого fuzzy member lookup или account→member inference нет.

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
paidByMemberId          exact request value (canonical member UUID | null)
status                  POSTED
analyticsState          INCLUDED
flowKind                null
version                 1 (create result envelope)
```

`occurredOn`, `amountMinor`, `fromAccountId`, `categoryId`, `paidByMemberId`, `description`, `note` приходят из canonical request. `paidByMemberId` не выводится из payment account. Результат обязан пройти `validateTransaction(..., { categoryKind: 'EXPENSE' })`.

## Idempotency store port

Port состоит из двух операций с разными ролями:

1. `readCommitted(idempotencyKey)` — безопасный pre-read уже committed request/result. Exact same request возвращается как `REPLAY` без current reference lookup и без генерации новой Transaction identity. Different request для того же key → `IDEMPOTENCY_CONFLICT`. Miss продолжает create path.
2. `createOrReplay({ request, candidate })` — **atomic race-closure** после pre-read miss и reference validation. Между pre-read и commit другой caller мог уже использовать key, поэтому store обязан атомарно вернуть один из трёх исходов.

Canonical idempotency equality включает `paidByMemberId`: тот же key с другим member или переходом `null ↔ member` считается другим request и даёт `IDEMPOTENCY_CONFLICT`. Уже committed exact replay сохраняет исходный payer и, как и раньше, не требует повторного чтения mutable references.

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

## Create TRANSFER v1

`idempotentTransferCreate.ts` добавляет отдельный type-specific application contract для plain TRANSFER без рефакторинга проверенных EXPENSE/INCOME paths. `WRITER_TRANSFER_CREATE_CONTRACT_VERSION = 1`.

Request:

```text
idempotencyKey  canonical lowercase UUID
occurredOn      valid full YYYY-MM-DD
amountMinor     positive safe integer
currency        RUB
fromAccountId   canonical lowercase UUID
toAccountId     canonical lowercase UUID, distinct from fromAccountId
description     null | non-empty already-trimmed text
note            null | non-empty already-trimmed text
```

Unknown fields и malformed lexical evidence fail-closed как `INVALID_REQUEST`; normalization/fuzzy matching отсутствуют. `flowKind` намеренно **не входит** в request этого среза: application не угадывает `OWN_FUNDS_TRANSFER`, `CREDIT_DRAW` или `CREDIT_REPAYMENT`. `idempotencyKey` отделён от canonical Transaction id.

На new-create miss dependency `readTransferCreateReferenceEvidence({fromAccountId, toAccountId})` обязана вернуть exact evidence для обоих requested account ids. Missing → `REFERENCE_NOT_FOUND`; mismatched/malformed/extra evidence → `REFERENCE_MISMATCH`; dependency exception → `REFERENCE_READ_FAILED` без raw diagnostics. Эта boundary не определяет provider/YDB query implementation.

Canonical TRANSFER projection:

```text
type                    TRANSFER
recordGranularity       TRANSACTION
datePrecision           DAY
aggregatePeriodMonth    null
financialPeriodId       null
periodAssignmentQuality UNASSIGNED
currency                RUB
fromAccountId           request.fromAccountId
toAccountId             request.toAccountId
categoryId              null
paidByMemberId          null
status                  POSTED
analyticsState          INCLUDED
flowKind                null
version                 1 (create result envelope)
```

Projection проходит существующий `validateTransaction(..., { categoryKind: null })`. Distinct-account invariant проверяется ещё на strict request boundary и затем повторно защищается canonical FIN-TRUTH validator.

Idempotency guarantees совпадают с уже доказанными EXPENSE/INCOME contracts, но universal create abstraction не вводится: exact committed pre-read → `REPLAY` без current reference lookup/new identity; changed canonical request на том же key → `IDEMPOTENCY_CONFLICT`; atomic `createOrReplay()` закрывает race после miss. Stored request/result и race response валидируются fail-closed против expected plain TRANSFER transaction; wrong type/direction/category/non-null `flowKind`/version/payload → `STORE_CONTRACT_INVALID`.

Safe application codes этого contract: `INVALID_REQUEST`, `REFERENCE_NOT_FOUND`, `REFERENCE_MISMATCH`, `REFERENCE_READ_FAILED`, `INVALID_GENERATED_TRANSACTION_ID`, `IDEMPOTENCY_CONFLICT`, `STORE_OPERATION_FAILED`, `STORE_CONTRACT_INVALID`. Raw reference/store/random-id diagnostics наружу не отражаются.

## Public TRANSFER create API envelope v1

`transferCreateApi.ts` добавляет только framework/provider-neutral public projection поверх `executeIdempotentTransferCreate()`. Request parsing, exact two-account reference validation, FIN-TRUTH projection и idempotency/store semantics не дублируются.

Успешный response имеет тот же минимальный acknowledgement shape, что и доказанные EXPENSE/INCOME create API:

```text
{
  apiVersion: 1,
  outcome: CREATED | REPLAY,
  idempotencyKey: canonical lowercase UUID,
  transactionId: canonical lowercase UUID,
  version: 1
}
```

`transactionId` остаётся отдельной canonical Transaction identity и не равен `idempotencyKey`; exact replay возвращает original `transactionId/version` из application contract. Envelope не возвращает full `CanonicalTransaction`, amount/date, source/destination account ids, description/note, `flowKind`, reference evidence или store/provider diagnostics.

Ошибки не получают отдельный API vocabulary: наружу проходит существующий stable value-free `TransferCreateError.code`. Этот слой намеренно не определяет HTTP status/path/body wrapping, headers/CORS, cookie/session verification, browser `fetch`, API Gateway/private Function или YDB/provider binding. Реальный OWNER/provider wiring остаётся за canonical provider gate #302.

Browser TRANSFER ACK/delete delivery уже доказан отдельным injected preview delivery module с validated ACK-before-delete и replay-safe cleanup; реальный HTTP/provider sender по-прежнему не подключён. Выбор `flow_kind` остаётся отдельным будущим work item. Наличие public envelope/delivery proof не меняет authority; production `YDB_WRITE_ENABLED=false`.

## Optimistic EXPENSE edit v1

`optimisticExpenseEdit.ts` добавляет первый type-specific edit application contract. Он работает только с ordinary `EXPENSE / TRANSACTION / DAY / POSTED` и не превращает historical `PERIOD_AGGREGATE`, VOIDED record или другой transaction type в editable purchase.

Request — полное canonical представление редактируемых полей, а не partial merge:

```text
transactionId     canonical lowercase UUID
expectedVersion   positive safe integer
occurredOn        valid full YYYY-MM-DD
amountMinor       positive safe integer
currency          RUB
fromAccountId     canonical lowercase UUID
categoryId        canonical lowercase UUID
paidByMemberId    canonical lowercase UUID | null
description       null | non-empty already-trimmed text
note              null | non-empty already-trimmed text
```

Identity/type/granularity/date precision/period assignment/status/analytics state/`flowKind` не входят в request и потому не могут молча меняться этим edit path. Candidate копирует эти поля из exact current record, заменяет только перечисленные mutable fields и обязан снова пройти FIN-TRUTH `validateTransaction(..., {categoryKind: "EXPENSE"})`. `paidByMemberId` хранится независимо от payment account; `null` означает отсутствие доказанного/выбранного payer, а не inference другого member.

Reference dependency принимает exact requested `fromAccountId`, `categoryId` и optional `paidByMemberId` и возвращает exact account/category/member evidence. Unknown/mismatched member не угадывается. Category kind обязан быть `EXPENSE`.

Store boundary состоит из двух операций:

1. `readCurrent(transactionId)` возвращает exact versioned current EXPENSE либо `null`; malformed/wrong-type/coarse/VOIDED evidence → fail-closed `STORE_CONTRACT_INVALID`.
2. `replaceIfVersion({transactionId, expectedVersion, candidate})` атомарно заменяет запись только при exact version match. `UPDATED` обязан read-back-like результатом доказать exact candidate и `version=expectedVersion+1`; concurrent race возвращает `VERSION_CONFLICT` с более новой `currentVersion`.

Stale `expectedVersion`, обнаруженный уже на pre-read, также возвращает normal `VERSION_CONFLICT` outcome до reference lookup/mutation. Это не exception и не last-write-wins. Preview-only browser comparison flow доказан отдельно через injected edit/current-read ports; production browser transport остаётся вне этого contract. Current financial payload не публикуется в GitHub evidence.

### Public EXPENSE edit API envelope v1

`expenseEditApi.ts` добавляет только framework/provider-neutral public projection поверх `executeOptimisticExpenseEdit()`. Request parsing, FIN-TRUTH validation, exact reference checks и atomic `replaceIfVersion` semantics не дублируются.

`UPDATED` возвращает только `apiVersion=1`, `outcome=UPDATED`, canonical `transactionId` и promoted `version`. `VERSION_CONFLICT` возвращает только `apiVersion=1`, `outcome=VERSION_CONFLICT`, тот же `transactionId` и `currentVersion`. Full `CanonicalTransaction`, amount/date, account/category/member ids, description/note и provider/store diagnostics в public envelope не возвращаются.

Application exceptions сохраняют существующий stable value-free `ExpenseEditError.code`; отдельный API error vocabulary не вводится. HTTP status/path/body wrapping, headers/CORS, cookie/session verification, browser `fetch`, API Gateway/private Function и YDB/provider binding этим слоем не определяются.

Preview browser conflict proof не расширяет public ACK финансовыми данными: `VERSION_CONFLICT` остаётся minimal version metadata, а актуальная financial запись читается отдельным injected `readCurrentExpense(transactionId)` port. Browser обязан проверить exact id/version и ordinary EXPENSE semantics до показа comparison. Ни accept-current, ни keep-local-rebase не выполняют автоматический повторный submit; overwrite возможен только новым явным user save с обновлённым `expectedVersion`.

Safe exception codes: `INVALID_REQUEST`, `TRANSACTION_NOT_FOUND`, `REFERENCE_NOT_FOUND`, `REFERENCE_MISMATCH`, `CATEGORY_KIND_INVALID`, `REFERENCE_READ_FAILED`, `STORE_OPERATION_FAILED`, `STORE_CONTRACT_INVALID`. Raw provider/store/reference diagnostics наружу не отражаются.

## Optimistic Transaction VOID v1

`optimisticTransactionVoid.ts` добавляет provider-neutral application transition `POSTED → VOIDED` для ordinary `EXPENSE | INCOME | TRANSFER`. Это status transition существующей exact Transaction, а не delete: contract не содержит delete/remove port и не создаёт новую transaction identity.

Request имеет ровно два поля:

```text
transactionId     canonical lowercase UUID
expectedVersion   positive safe integer
```

`readCurrent(transactionId)` обязан вернуть exact versioned canonical Transaction либо `null`. Contract принимает только `recordGranularity=TRANSACTION`, `datePrecision=DAY`, `aggregatePeriodMonth=null`, valid RUB/domain shape и strict canonical fields. `PERIOD_AGGREGATE`, `UNKNOWN`, malformed ids/version/status/analytics/flow и другие невозможные store states fail-closed как `STORE_CONTRACT_INVALID`. VOID не выполняет reference lookup и не пытается повторно вывести category kind, payer или другой финансовый смысл: существующие account/category/payer/date/amount/note/type/flow/analytics/period fields сохраняются value-equivalent.

Если pre-read version отличается от `expectedVersion`, normal outcome — `VERSION_CONFLICT` с текущей version и без mutation. Если version совпадает, но current status уже `VOIDED`, normal outcome — `ALREADY_VOIDED`, также без mutation. Для exact `POSTED` строится candidate с единственным domain изменением `status=VOIDED` и `version=expectedVersion+1`.

Atomic store port `voidIfVersion({transactionId, expectedVersion, candidate})` обязан либо вернуть `VOIDED` с exact promoted candidate, либо race `VERSION_CONFLICT` с более новой version. Successful result повторно проверяется: id, version и каждый canonical field должны совпасть с candidate; changed financial payload, unchanged `POSTED`, impossible version или malformed outcome → `STORE_CONTRACT_INVALID`. Store exceptions санитизируются как `STORE_OPERATION_FAILED`; missing transaction — `TRANSACTION_NOT_FOUND`; malformed request — `INVALID_REQUEST`.

Application response vocabulary: `VOIDED | ALREADY_VOIDED | VERSION_CONFLICT`. Browser confirmation, local outbox/retry и provider/YDB persistence этим contract ещё не определены. FIN-TRUTH остаётся прежним: `VOIDED` видим как historical fact, но исключён из normal analytics/PeriodClose.

## Public Transaction VOID API v1

`transactionVoidApi.ts` — thin provider-neutral projection поверх `executeOptimisticTransactionVoid()`. Wrapper не повторяет parsing, optimistic checks или store transition и принимает только существующий `OptimisticTransactionVoidStore`. Body без normalization передаётся application contract.

Public response намеренно минимален:

```text
VOIDED          { apiVersion: 1, outcome, transactionId, version }
ALREADY_VOIDED  { apiVersion: 1, outcome, transactionId, version }
VERSION_CONFLICT { apiVersion: 1, outcome, transactionId, currentVersion }
```

Full `CanonicalTransaction`, `contractVersion`, amount/date/account/category/payer/note/analytics/flow и provider/store diagnostics в public ACK не входят. Typed application errors сохраняют существующий safe vocabulary без отдельного API-specific error layer. HTTP method/path/status mapping, OWNER auth/session binding, browser confirmation/outbox и provider persistence остаются отдельными work items.

## Non-scope

- HTTP status/body mapping и OWNER session binding;
- YDB idempotency table/transaction implementation;
- outbox POST/retry worker;
- real TRANSFER HTTP sender и выбор `flow_kind`;
- real production browser EXPENSE edit/current-record transport;
- INCOME/TRANSFER edit;
- HTTP/router/auth binding для VOID, browser confirmation/outbox/retry и provider persistence;
- Google Form/GAS intake parity;
- production Writer, R4, CUTOVER.
