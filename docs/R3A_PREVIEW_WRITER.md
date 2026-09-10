# R3A Writer preview — local-only EXPENSE outbox

## Назначение

Первый R3A S-unit доказывает только local-first UX создания расхода на синтетических данных. Он не создаёт production Writer и не меняет financial authority.

До CUTOVER остаётся:

```text
Google authoritative → YDB shadow
```

Production `index.html` / `app.mjs` по-прежнему read-only. Writer подключается только через synthetic `preview-bootstrap.mjs` и явно помечен как `Новый расход · демо`.

## Quick EXPENSE preview contract

Форма принимает только:

- positive RUB amount с максимум двумя decimal digits; преобразование выполняется exact integer arithmetic в minor units без float rounding;
- `occurred_on` как valid full `YYYY-MM-DD`;
- source account из exact `syntheticPreviewEvidence.accounts`;
- category из exact `syntheticPreviewEvidence.categories` только при `kind=EXPENSE`;
- optional literal description;
- optional literal note.

Пустые optional form values сохраняются как `null`. Непустой текст не классифицируется, не тегируется и не используется для financial inference.

Это **preview UX contract**, а не доказанная копия Google Form/GAS. Legacy intake defaults/validation/triggers должны быть отдельно инвентаризированы до production Writer.

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

## Local draft

Незавершённая форма хранится отдельно от `PENDING` intent:

```text
{
  schemaVersion: 1,
  draftKey: quick-expense,
  savedAt: timestamp,
  amount: string,
  occurredOn: string,
  accountId: string,
  categoryId: string,
  description: string,
  note: string
}
```

Draft — **не финансовый факт и не CanonicalTransaction**. Поэтому его поля могут быть пустыми или ещё невалидными: это literal состояние формы. При restore malformed envelope fail-closed игнорируется; stale/unknown account/category id не нормализуется и не fuzzy-map-ится, а восстанавливается пустым выбором. Остальные literal поля сохраняются без классификации/inference.

Изменения формы сохраняют draft локально без network round-trip. При submit Writer сначала ждёт уже поставленные draft writes, затем валидирует форму как EXPENSE intent и durable commit-ит `PENDING` в `outbox`. Только после успешного outbox commit выполняется удаление draft. Ошибка enqueue не очищает draft. Если outbox уже committed, но cleanup draft не удался, UI честно показывает degraded local status вместо утверждения о полном cleanup.

Versioned durable intent:

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

Enqueue заканчивается после IndexedDB commit. После успешного local commit и successful draft cleanup UI показывает `Сохранено локально · демо · не отправлено` и обновляет durable pending count.

Malformed durable rows fail-closed и не считаются валидными pending intents. Browser ничего не normalizes/fixes при чтении повреждённого outbox evidence.

## Network и authority boundary

Save path не содержит `fetch`, Reader API mutation, YDB/Google endpoint или provider credential. Этот S-unit не определяет server create endpoint, idempotency key protocol, retry worker или sync cadence.

Следовательно:

- offline local save и reload-safe draft уже можно проверять как UX/mechanics proof;
- «сохранено локально» не означает «записано в YDB» или «синхронизировано»;
- production `YDB_WRITE_ENABLED=true` остаётся запрещён до CUTOVER GATE;
- R1 #302 и production R2 auth/YDB wiring этим S-unit не обходятся.

## Не входит

- production Writer UI;
- Google Form/GAS intake parity;
- server idempotent create;
- outbox retry/sync worker;
- `paid_by_member`;
- INCOME / TRANSFER;
- edit / VOID / optimistic conflict;
- FinancialPeriod membership;
- provider deployment или authority cutover.

## Outbox delivery / ACK boundary

Следующий preview-only слой связывает локальный `CREATE_EXPENSE / PENDING` intent с public create API envelope, но всё ещё **не** задаёт реальный HTTP transport.

- `intentId` передаётся как `idempotencyKey`; новая client identity не создаётся;
- в sender request уходят только canonical поля create contract: date, amount minor units, account/category ids и optional literal text;
- локальные `createdAt` и reference labels в request не уходят;
- sender является injected `sendExpenseCreate(request)` port: URL, `fetch`, HTTP status, cookies, auth и provider binding здесь отсутствуют;
- valid ACK обязан точно соответствовать create API v1: `apiVersion=1`, `CREATED|REPLAY`, тот же `idempotencyKey`, отдельный canonical `transactionId`, `version=1`;
- malformed/mismatched ACK fail-closed и не удаляет local intent;
- IndexedDB outbox удаляет row только после valid ACK;
- sender failure также оставляет `PENDING` для будущего retry;
- если server успел commit, но локальный `acknowledge()` не удался, row остаётся. Следующий delivery повторяет тот же idempotency key и поэтому может получить `REPLAY`, после чего безопасно удалить row;
- один delivery invocation делает не более одной sender попытки; retry cadence/backoff/scheduling здесь не определяются.

Это crash/retry mechanics proof. Реальный browser HTTP sender, OWNER session transport, API Gateway/private Function и YDB persistence остаются отдельными gates; production `YDB_WRITE_ENABLED=false`.
