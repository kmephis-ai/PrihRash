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

Последняя live read-only проверка header по exact Google spreadsheet identity: **2026-09-10**.

Текущая проверенная схема содержит 11 колонок:

| Position | Physical header | Stable adapter key | Meaning |
|---|---|---|---|
| A | `Отметка времени` | `date` | legacy source date/datetime |
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

Read-only re-verification 2026-09-10 локализовала physical schema evolution: по сравнению с контрактом, проверенным 2026-09-06, изменился только exact header A — ` Дата` → `Отметка времени`; B–K, spreadsheet title, locale, timezone и canonical sheet identity совпали. Это не alias и не повод угадывать новую финансовую семантику: stable adapter key остаётся `date`, а сам label `Отметка времени` **не доказывает** `captured_at`. Canonical interpretation source serial остаётся прежней и определяется `FINANCIAL_SEMANTICS`.

Текущий source adapter schema version: **3**. Новые Google observations обязаны emit `adapter_schema_version=3`. Persisted v2 provenance остаётся readable для compatibility, но current reader не принимает старый header vector как alias.

Перед чтением payload adapter проверяет ожидаемое число/порядок колонок и exact current header labels. Неожиданное schema drift → fail-closed `SOURCE_SCHEMA_MISMATCH`.

### 2.1. Typed cell representation

Read-only provider verification 2026-09-06 подтверждает spreadsheet metadata `locale=ru_RU`, `timeZone=Europe/Moscow`. Locale **не используется** для угадывания numeric strings: adapter читает Google cell type напрямую.

Для canonical A–K adapter сохраняет `ExtendedValue` kind до normalization/persistence:

```text
blank       → null
stringValue → STRING
numberValue → NUMBER
formulaValue / boolValue / errorValue → fail-closed
```

`NUMBER` сериализуется как canonical plain decimal из provider `numberValue`; `STRING` получает только технически безопасную NFC + line-ending normalization. Строка, внешне похожая на число, остаётся `STRING` и никогда автоматически не становится amount/date.

Private full-source probe текущего authoritative sheet подтвердил безопасный bootstrap predicate без публикации payload: у всех распознанных `Расход`/`Доход` source date и **operation-active** amount имеют numeric cell type; formula в A–K не обнаружены. Неприменимый к operation type второй amount column не используется для финансового decode и может содержать legacy non-active values.

Google Sheets date/datetime хранится как serial number spreadsheet civil time. Для текущего source timezone — `Europe/Moscow`; importer сохраняет raw serial с fractional component, а canonical `occurred_on` получает calendar day из whole serial day. Он не превращает source serial во guessed `captured_at`.

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

## 10. R0 proven physical predicate — zero/service close markers

Read-only probe 2026-09-06 подтвердил: exact A–K schema и documented operation/account/Vika vocabulary совпадают с live source.

Conceptual close labels сами по себе недостаточны: physical `description` имеет spelling variants, а literal `Итоги по месяцу` не подтверждён как обязательный A–K marker текущего authoritative source. Поэтому R0 проверил полный private source и зафиксировал следующий deterministic predicate.

### 10.1. Exact marker vocabulary

Только следующие **exact observed** `description` values имеют structural marker meaning:

```text
POSITIVE:
  Плюсовые позиции

CREDIT:
  Кредитки
  Кредитка
  Кредитки 2

NEGATIVE:
  Минусовые позиции

VIKA:
  Вика Красное
  Вика красное

LOAN:
  Возврат займа

BALANCE:
  Текущий баланс
  Текущий баланс счета
```

Это explicit source vocabulary, а не fuzzy aliases. Case-folding, spelling correction и похожие варианты не принимаются автоматически.

### 10.2. Marker-row shape

Row становится marker candidate только если одновременно:

```text
operation_type   = Расход
expense_account  = Карта Visa
expense_amount   = 0
source_day       = known
marker_kind      = exact vocabulary above
```

`source_day` — calendar day из технически нормализованного physical `date` текущего snapshot; это не `captured_at` и не Transaction period membership.

`expense_category` в predicate **не входит**: private evidence показывает, что category менялась между historical close rows и не является identity.

Description-like label при positive amount не является close marker и продолжает обычную financial classification.

### 10.3. Cluster predicate

Marker candidates группируются внутри одного `source_day` и текущей snapshot sequence. Если разница между соседними candidate ordinals больше `2`, начинается новый cluster. То есть допускается максимум одна посторонняя source row между соседними markers; ordinal используется только как sequence context, никогда как SourceRecord identity.

Cluster считается доказанным `LEGACY_PERIOD_CLOSE`, только если содержит:

```text
BALANCE
NEGATIVE
VIKA
и хотя бы один из:
  POSITIVE | CREDIT
```

`LOAN` optional. Exact duplicate marker kind допустим и сам по себе не создаёт новый close.

Только exact marker rows внутри доказанного cluster получают `LEGACY_PERIOD_CLOSE`. Посторонняя zero row внутри того же day/window не повышается до close marker. Known marker row вне доказанного cluster → fail-closed `AMBIGUOUS`/`REVIEW_REQUIRED`.

### 10.4. Private full-source evidence

Полный read-only source probe подтвердил predicate на всей доступной истории: все повторяемые close clusters проходят rule, а изолированные known service markers остаются ambiguous вместо ложного close. Public repository хранит только этот structural rule, synthetic fixtures и безопасный aggregate status; реальные rows, dates, amounts, notes, row hints/snapshots и private digests не публикуются.
