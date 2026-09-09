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
version: 1
store: outbox
```

Он намеренно не использует Reader cache DB `prihrash-reader`.

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

Enqueue заканчивается после IndexedDB commit. После успешного local commit UI показывает `Сохранено локально · демо · не отправлено` и обновляет durable pending count.

Malformed durable rows fail-closed и не считаются валидными pending intents. Browser ничего не normalizes/fixes при чтении повреждённого outbox evidence.

## Network и authority boundary

Save path не содержит `fetch`, Reader API mutation, YDB/Google endpoint или provider credential. Этот S-unit не определяет server create endpoint, idempotency key protocol, retry worker или sync cadence.

Следовательно:

- offline local save уже можно проверять как UX/mechanics proof;
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
