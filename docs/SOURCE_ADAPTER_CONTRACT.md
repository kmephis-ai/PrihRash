# Source Adapter Contract — `Ответы на форму (11)`

Этот документ фиксирует **физическую схему legacy Google source** и минимальные правила адаптера. Он не является копией финансовых данных и не содержит реальные операции.

Цель: normalizer не должен угадывать, какой из двух столбцов `Счет` или `Сумма` имеется в виду, придумывать aliases или восстанавливать TRANSFER из косвенных признаков.

## 1. Canonical source

Единственный transactional source:

```text
Google spreadsheet: ПрихРасхOnline
sheet: Ответы на форму (11)
```

Reference sheets не участвуют в создании Transactions.

## 2. Physical columns

Последняя live read-only проверка header по exact Google spreadsheet identity: **2026-09-06**.

Текущая проверенная схема содержит 11 колонок:

| Position | Physical header | Stable adapter key | Meaning |
|---|---|---|---|
| A | ` Дата` | `date` | legacy source date/datetime |
| B | `Тип операции` | `operation_type` | `Расход` / `Доход` |
| C | `Счет` | `expense_account` | expense payment account |
| D | `Категория` | `expense_category` | expense category |
| E | `Наименование` | `description` | free legacy description |
| F | `Сумма` | `expense_amount` | expense amount |
| G | `Счет` | `income_account` | income destination account |
| H | `Источник` | `income_category` | **income category**, not provenance source |
| I | `Сумма` | `income_amount` | income amount |
| J | `Вика` | `vika_flag` | legacy Vika flag |
| K | `Примечание` | `note` | free note/context |

У физического source два одинаковых header `Счет` и два `Сумма`. Поэтому adapter работает через **позиционную схему + stable adapter keys**, а не через автоматически придуманные parser names вроде `Счет.1`/`Сумма.1`.

Перед чтением payload adapter проверяет ожидаемое число/порядок колонок и нормализованные header labels. Неожиданное schema drift → fail-closed `SOURCE_SCHEMA_MISMATCH`.

## 3. Operation type recognition

Для normal financial rows тип определяется **только** явным `operation_type`:

```text
Расход → EXPENSE candidate
Доход  → INCOME candidate
```

Если `operation_type` пуст/неизвестен, adapter не пытается вывести тип из заполненности соседних полей. Такая строка классифицируется дальнейшим classifier как `NON_FINANCIAL`, `INVALID` или `AMBIGUOUS`.

Zero/service rows с `operation_type=Расход` сначала проходят общую source classification и не становятся Transaction автоматически.

## 4. Observed account vocabulary

На audited source snapshot подтверждены следующие значения. Перед full-data normalization R0 повторно проверяет live vocabulary fail-closed; список ниже не является разрешением принимать новые aliases автоматически.

Expense account:

```text
Карта Visa
Карта Credit
Наличка
```

Income account:

```text
Карта Visa
Наличка
Карта Credit
Приход
```

`Приход` сохраняется как отдельный legacy account с `kind=UNKNOWN`, `balance_nature=UNKNOWN`, пока не появится доказанная более точная семантика.

Adapter **не добавляет aliases по предположению** (`Visa`, `VISA`, `Credit` и т.п.). Если новое значение реально появилось, оно должно попасть в fail-closed review/source-vocabulary update, а не молча слиться с существующим Account.

## 5. Vika mapping

Для EXPENSE:

```text
vika_flag = "Да" → paid_by_member = Вика
vika_flag blank   → paid_by_member = null / unknown
```

Blank не означает «точно не Вика».

Для Credit legacy history blank также не позволяет восстановить плательщика.

## 6. Reference entity bootstrap identity

### Category

Первичный bootstrap grouping key:

```text
(kind, normalized_source_label)
```

где `kind = EXPENSE | INCOME`.

Расходная и доходная категории с одинаковым текстом не являются одной Category.

Нормализация identity key ограничена технически безопасными действиями: Unicode normalization + trimming accidental outer whitespace. Никакого fuzzy merge, spelling correction или AI aliasing.

После создания Category имеет стабильный UUID; последующее изменение display name не меняет identity.

### Account

Первичный bootstrap grouping key:

```text
(normalized_source_label, currency=RUB)
```

После создания Account имеет стабильный UUID. Source aliases могут добавляться только явным доказанным mapping change.

### FamilyMember

Legacy `Вика=Да` маппится на стабильный `FamilyMember(Вика)`. Другой member из blank не выводится.

## 7. Legacy TRANSFER

В текущем source нет доказанного отдельного legacy operation type `TRANSFER`.

Поэтому Google importer:

- нормализует доказанные EXPENSE и INCOME;
- **не синтезирует TRANSFER** из пар строк, сумм, дат или account changes;
- не реконструирует погашение кредитки/заёмные движения без отдельного доказанного source contract.

`TRANSFER` остаётся полноценным canonical type для новой PWA и synthetic domain tests.

## 8. Unknown vocabulary

Неизвестный operation type/account/structural source value:

```text
→ fail-closed
→ AMBIGUOUS / INVALID / REVIEW_REQUIRED
```

Нельзя автоматически применять case-insensitive/fuzzy alias только потому, что строка «похожа» на известную.

## 9. Safe public evidence

В public repository допустимы:

- список header names;
- stable adapter keys;
- безопасный vocabulary справочников;
- synthetic examples.

Не публикуются:

- реальные строки операций;
- реальные суммы/описания/notes;
- private source snapshots.

## 10. R0 live refinement — zero/service close markers

Read-only probe 2026-09-06 подтвердил: exact A–K schema и documented operation/account/Vika vocabulary совпадают с live source.

Для legacy zero/service rows обнаружено, что conceptual close labels не образуют достаточный exact physical predicate сами по себе: physical `description` имеет spelling variants, а literal `Итоги по месяцу` не подтверждён как обязательный A–K marker текущего authoritative source.

Следовательно:

- `amount=0` никогда не становится normal Transaction;
- category не используется как close-marker identity;
- description-like conceptual label сам по себе не доказывает `LEGACY_PERIOD_CLOSE`;
- R0 обязан доказать deterministic cluster/context predicate на private data и перенести правило в synthetic fixtures;
- до этого unproven zero/service rows → `NON_FINANCIAL` / `AMBIGUOUS`, fail-closed.

Public evidence может содержать только безопасный список vocabulary/status; реальные rows, amounts, notes, row snapshots и private digests не публикуются.
