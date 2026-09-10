# R3A Writer preview — local-only EXPENSE/INCOME/TRANSFER outbox

## Назначение

R3A synthetic preview доказывает local-first UX и offline-write механику без изменения production authority. Сейчас preview поддерживает локальное создание EXPENSE, INCOME и базового TRANSFER; production `index.html` / `app.mjs` остаются read-only.

До CUTOVER сохраняется:

```text
Google authoritative → YDB shadow
```

Writer подключается только через synthetic `preview-bootstrap.mjs`. Панели явно помечены `Новый расход · демо`, `Новый доход · демо` и `Новый перевод · демо`; реальные финансовые данные и production Writer path не используются.

## Quick EXPENSE preview contract

Форма EXPENSE принимает только:

- positive RUB amount с максимум двумя decimal digits; преобразование выполняется exact integer arithmetic в minor units без float rounding;
- `occurred_on` как valid full `YYYY-MM-DD`;
- source account из exact `syntheticPreviewEvidence.accounts`;
- category из exact `syntheticPreviewEvidence.categories` только при `kind=EXPENSE`;
- optional literal description;
- optional literal note.

## Quick INCOME preview contract

Форма INCOME использует тот же exact amount/date/text contract, но financial direction другая и не угадывается:

- account является **destination account**;
- category принимается только при exact `kind=INCOME`;
- durable payload содержит `toAccount`, а не `fromAccount`;
- никакой provenance/source inference из income category или description не выполняется.

Пустые optional form values сохраняются как `null`. Непустой текст не классифицируется, не тегируется и не используется для financial inference.

## Quick TRANSFER preview contract

Базовая форма TRANSFER использует тот же exact amount/date/text contract, но не приписывает переводу недоказанный subtype:

- source account выбирается как exact `fromAccount` из `syntheticPreviewEvidence.accounts`;
- destination account выбирается как exact `toAccount` из того же списка;
- source и destination обязаны различаться;
- category отсутствует;
- durable payload хранит `flowKind=null` **явно**; ни labels счетов, ни направление, ни description/note не превращаются в `OWN_FUNDS_TRANSFER`, `CREDIT_DRAW` или `CREDIT_REPAYMENT`;
- до отдельного доказанного UX/semantics item preview показывает обычный «Перевод» без guessed classification.


Все три формы — **preview UX contract**, а не доказанная копия Google Form/GAS. Legacy intake defaults/validation/triggers должны быть отдельно инвентаризированы до production Writer.

## Local outbox

Preview Writer использует отдельный IndexedDB namespace:

```text
DB: prihrash-r3a-preview
version: 2
stores:
  - outbox
  - drafts
```

Он намеренно не использует Reader cache DB `prihrash-reader`. DB `v2` — additive migration: при upgrade с `v1` существующий `outbox` не удаляется и не переписывается, добавляется только отсутствующий store `drafts`.

Outbox принимает только strict known union:

```text
CREATE_EXPENSE / PENDING
CREATE_INCOME / PENDING
CREATE_TRANSFER / PENDING
```

Unknown kind/schema/state и malformed durable rows fail-closed и не считаются валидными pending intents. Browser ничего не normalizes/fixes при чтении повреждённого evidence.

EXPENSE durable intent:

```text
{
  schemaVersion: 1,
  intentId: canonical lowercase UUID,
  kind: CREATE_EXPENSE,
  state: PENDING,
  createdAt: timestamp,
  payload: {
    type: EXPENSE,
    occurredOn,
    amountMinor,
    currency: RUB,
    fromAccount: { id, label },
    category: { id, label, kind: EXPENSE },
    description: string | null,
    note: string | null
  }
}
```

INCOME durable intent:

```text
{
  schemaVersion: 1,
  intentId: canonical lowercase UUID,
  kind: CREATE_INCOME,
  state: PENDING,
  createdAt: timestamp,
  payload: {
    type: INCOME,
    occurredOn,
    amountMinor,
    currency: RUB,
    toAccount: { id, label },
    category: { id, label, kind: INCOME },
    description: string | null,
    note: string | null
  }
}
```

TRANSFER durable intent:

```text
{
  schemaVersion: 1,
  intentId: canonical lowercase UUID,
  kind: CREATE_TRANSFER,
  state: PENDING,
  createdAt: timestamp,
  payload: {
    type: TRANSFER,
    occurredOn,
    amountMinor,
    currency: RUB,
    fromAccount: { id, label },
    toAccount: { id, label },
    flowKind: null,
    description: string | null,
    note: string | null
  }
}
```

`category` в TRANSFER payload отсутствует. Non-null `flowKind`, одинаковые source/destination accounts или лишние поля считаются malformed durable evidence и fail-closed.

## Local drafts

Незавершённая форма хранится отдельно от `PENDING` intent. EXPENSE, INCOME и TRANSFER используют разные keys в одном `drafts` store:

```text
quick-expense
quick-income
quick-transfer
```

EXPENSE/INCOME draft envelope имеют `schemaVersion=1`, `savedAt` и literal поля `amount`, `occurredOn`, `accountId`, `categoryId`, `description`, `note`. TRANSFER draft использует те же metadata/text fields, но вместо category содержит два literal reference fields: `fromAccountId` и `toAccountId`.

Draft — **не финансовый факт и не CanonicalTransaction**. Поля могут быть пустыми или ещё невалидными. При restore malformed envelope fail-closed игнорируется; stale/unknown account/category id не нормализуется и не fuzzy-map-ится, а восстанавливается пустым выбором. Для category дополнительно требуется exact текущий kind формы: EXPENSE или INCOME. В TRANSFER source/destination refs восстанавливаются независимо; draft может оставаться incomplete/invalid до submit, включая одинаковые выбранные счета.

Изменения формы сохраняют соответствующий draft локально без network round-trip. При submit Writer сначала ждёт уже поставленные draft writes, затем валидирует форму и durable commit-ит соответствующий `PENDING` intent в `outbox`. Только после успешного outbox commit удаляется **draft этой формы**. Ошибка enqueue не очищает draft. Cleanup одной формы не удаляет draft любой другой формы.

После successful local commit и cleanup UI показывает `Сохранено локально · демо · не отправлено`. Если outbox committed, но draft cleanup не удался, UI честно показывает degraded local status.

## Network и authority boundary

EXPENSE/INCOME/TRANSFER local save path не содержит `fetch`, Reader API mutation, YDB/Google endpoint или provider credential.

- EXPENSE имеет отдельные application/API/idempotency и injected ACK-delivery proofs;
- INCOME также имеет отдельные application/idempotency, minimal public API envelope и injected ACK-delivery proofs;
- TRANSFER также имеет отдельные application/idempotency, minimal public API envelope и injected ACK-delivery proofs;
- реальный browser HTTP sender для EXPENSE/INCOME/TRANSFER всё ещё не подключён;
- «сохранено локально» не означает «записано в YDB» или «синхронизировано»;
- production `YDB_WRITE_ENABLED=true` остаётся запрещён до CUTOVER GATE;
- R1 #302 и production R2 auth/YDB wiring не обходятся.

## EXPENSE outbox delivery / ACK boundary

Существующий preview-only delivery layer относится только к `CREATE_EXPENSE / PENDING` и связывает его с public EXPENSE create API envelope без реального HTTP transport.

- `intentId` передаётся как `idempotencyKey`;
- sender является injected `sendExpenseCreate(request)` port;
- valid ACK обязан точно соответствовать create API v1: `apiVersion=1`, `CREATED|REPLAY`, тот же `idempotencyKey`, отдельный canonical `transactionId`, `version=1`;
- malformed/mismatched ACK или sender failure не удаляет local intent;
- IndexedDB outbox удаляет EXPENSE row только после valid ACK;
- если server успел commit, но local `acknowledge()` не удался, следующий delivery повторяет тот же key и может безопасно завершить cleanup через `REPLAY`;
- один delivery invocation делает не более одной sender попытки; retry cadence/backoff/scheduling здесь не определяются.

INCOME использует отдельный type-specific preview delivery module с теми же crash/retry invariants, но с `toAccountId` и injected `sendIncomeCreate(request)`. Он не рефакторит доказанный EXPENSE path: malformed/mismatched ACK не удаляет local intent, valid `CREATED|REPLAY` ACK предшествует `acknowledge()`, а local delete failure оставляет тот же idempotency key для безопасного `REPLAY` при следующем явном вызове. Automatic retry cadence/backoff здесь не определяются.

TRANSFER использует отдельный type-specific preview delivery module с injected `sendTransferCreate(request)`. Request содержит только `idempotencyKey`, `occurredOn`, `amountMinor`, `currency=RUB`, exact `fromAccountId`, exact `toAccountId`, `description`, `note`: local labels/metadata и `flowKind=null` в transport envelope не передаются. Valid `CREATED|REPLAY` ACK проверяется до exact-key `acknowledge()`, sender/local-ACK failures санитизируются, а crash после server commit безопасно завершается повтором того же key и `REPLAY`. Automatic retry cadence/backoff здесь не определяются.

## Не входит

- production Writer UI;
- Google Form/GAS intake parity;
- real browser HTTP sender / API Gateway / private Function;
- real INCOME HTTP sender / provider-bound delivery;
- real TRANSFER HTTP sender / provider-bound delivery;
- TRANSFER flow-kind selection/inference, включая credit draw/repayment UX;
- automatic retry/sync scheduler;
- create-time `paid_by_member` UX/delivery;
- browser edit/conflict UI;
- INCOME/TRANSFER edit;
- VOID;
- FinancialPeriod membership;
- provider deployment или authority cutover.
