# Финансовая семантика PrihRash

Этот документ описывает не бухгалтерскую теорию, а фактическую пользовательскую логику PrihRash, восстановленную из текущего процесса и данных.

## 1. Как сегодня фиксируются расходы

Расходы вносятся через форму. Пользователь вручную определяет категорию.

Если один чек содержит несколько аналитически значимых групп, он вручную делится на несколько операций. Пример:

- Продукты — 2334 ₽;
- Алкоголь — 667 ₽.

Детализация до отдельных товарных позиций сейчас не ведётся. Будущий QR/receipt pipeline должен уметь автоматизировать это разбиение, но не менять сам принцип аналитического распределения.

## 2. Инструменты оплаты

Основные legacy accounts:

- `Карта Visa` — дебетовая карта;
- `Карта Credit` — кредитная карта;
- `Наличка` — наличные.

Новая модель сохраняет исходный payment account как исторический факт.

## 3. Вика

Legacy `Вика=Да` означает, что расход оплатила Вика наличными или дебетовой картой.

Если Вика платит кредиткой, `Вика=Да` не ставится: операция выглядит как обычная `Карта Credit`.

Следствия:

- `Да` достоверно означает Вику;
- blank не доказывает «не Вика»;
- новая PWA должна хранить `paid_by_member_id` независимо от payment account;
- исторические Credit-расходы Вики могут остаться неопределимыми.

## 4. Примечание

`note` — свободное пользовательское поле.

Примеры использования:

- ссылка на интернет-магазин;
- пробег автомобиля при ТО;
- пояснение;
- общая аналитическая метка вроде `Море 2024`.

Не нормализовать note насильно. В будущем поверх него могут появиться tags/contexts.

## 5. Дата операции

Операция может быть внесена через несколько дней после события. Пользователь исправляет дату, но время обычно не важно.

Поэтому:

- `occurred_on` — финансовая бизнес-дата;
- `captured_at` — доказанное время фактического capture, если оно известно; для legacy history может быть `null`;
- raw Google datetime сохраняется в SourceRecordRevision и не выдаётся за точный capture time, если пользователь мог его вручную менять.

Calendar analytics используют `occurred_on`. Принадлежность к расчётному периоду хранится отдельно и не вычисляется только из даты.

### 5.1. Live mutable source до закрытия периода

`Ответы на форму (11)` — не append-only журнал. До CUTOVER это живая рабочая таблица. Основной intake идёт через Google Form, но обычная financial row может очень редко быть создана вручную; сам факт отсутствия Form provenance не делает строку невалидной.

Пока legacy working period остаётся OPEN, владелец может:

- исправлять дату в physical A; обычно меняется календарный день, а время не имеет самостоятельной financial semantics;
- исправлять amount/category/account/Vika/description/note;
- перемещать и сортировать строки;
- удалить ошибочную/полностью возвращённую операцию;
- добавлять новые операции параллельно shadow sync.

Row position/ordinal — locator, не financial identity. Pure reorder сам по себе не создаёт revision и не меняет финансовый смысл.

OPEN-period disappearance может означать owner cancellation. YDB history физически не удаляется: automatic effect допустим только когда OPEN working-set membership и exact linked identity доказаны отдельным migration rule; иначе review-required. Для CLOSED period disappearance не применяется автоматически.

После доказанного close финансовая часть периода считается стабильной. Metadata-only `note` correction допустима без пересчёта PeriodClose, если никакие финансовые поля не изменились.

## 5.2. Историческая гранулярность и точность даты

Source history неоднородна: часть ранних расходов может представлять месячные/периодные агрегаты по категории, а более поздняя история — реальные item-level операции. Нельзя изображать оба типа одинаково.

Canonical поля:

```text
record_granularity:
  TRANSACTION | PERIOD_AGGREGATE | UNKNOWN

date_precision:
  DAY | MONTH | UNKNOWN

aggregate_period_month?
```

Правила:

- `TRANSACTION` допускает обычный transaction drill-down;
- `PERIOD_AGGREGATE` участвует в корректных totals за соответствующий период, но не считается отдельной покупкой конкретного дня и не редактируется ordinary transaction editor как item-level purchase;
- `UNKNOWN` не повышается до более точного уровня эвристикой;
- для `PERIOD_AGGREGATE` `aggregate_period_month` нормализуется как первый день месяца (`YYYY-MM-01`); календарная дневная аналитика не использует `occurred_on` как точную дату покупки;
- граница historical epochs определяется deterministic R0 classifier + reference reconciliation, а не hardcoded датой без доказательства;
- aggregate и item-level records одного covered period/category не суммируются вместе без доказанной additive semantics; иначе overlap считается ambiguous.

## 6. Доходы

Доходные операции хранятся отдельно от расходов.

Legacy `Источник` фактически является income category, а не provenance source.

Получение 100 000 ₽ заёмной ликвидности с кредитной карты не является доходом.

## 7. Кредитная карта

Покупка кредиткой — это EXPENSE в момент покупки.

Погашение кредитной карты с Visa — TRANSFER, а не второй расход.

Нельзя после закрытия периода переписывать исходный payment account Credit→Visa в canonical history.

## 8. Ежемесячный беспроцентный перевод 100 000 ₽

Пользователь ежемесячно получает 100 000 ₽ с кредитной карты, переводит их в другой банк и затем возвращает около расчётного дня.

Семантика:

- получение 100 000 ₽ ≠ INCOME;
- возврат 100 000 ₽ ≠ EXPENSE;
- это liability/cash movement;
- legacy `Возврат займа 100000` — reminder/control item.

В будущем можно использовать `TRANSFER + flow_kind=CREDIT_DRAW/CREDIT_REPAYMENT` или отдельную liability capability, но не расширять Transaction prematurely.

## 9. Расчётный период

Target close day сейчас обычно 14-е, но иногда закрытие сдвигается.

Следовательно:

- `target_close_day` — настройка/напоминание;
- фактический close — отдельное событие;
- `occurred_on` и `financial_period_id` отвечают на разные вопросы;
- после активации FinancialPeriod capability (R4) новый PWA capture получает current OPEN `financial_period_id`; до R4 production legacy records остаются `NULL/UNASSIGNED`, а R3A использует только test/private pilot semantics;
- после close в тот же календарный день новые captures получают уже следующий period;
- поздний ввод в CLOSED period требует preview и явного пересчёта;
- для legacy операции на спорной границе допускается `LEGACY_AMBIGUOUS`, а не угадывание.

Это устраняет неразрешимую неоднозначность, когда close и новая покупка происходят в один календарный день.

## 10. Settlement buckets

В рамках PeriodClose каждый INCLUDED EXPENSE должен попасть ровно в один bucket.

### CreditCards

Все расходы, оплаченные кредитной картой, независимо от плательщика.

### VikaRed

Расходы Вики, оплаченные не кредиткой.

### NegativePositions

Все остальные расходы периода.

Правило:

```text
if payment_account == CREDIT_CARD:
    bucket = CREDIT_CARDS
elif paid_by_member == VIKA:
    bucket = VIKA_RED
else:
    bucket = NEGATIVE_POSITIONS
```

Для legacy данных blank `Вика` при non-credit расходе трактуется по старому процессу как ordinary negative position, потому что других доказательств нет.

## 11. PositivePositions

`PositivePositions = SUM(INCLUDED INCOME)` за текущий расчётный период.

Заёмные 100 000 ₽ не включаются.

## 12. Closing balance

Legacy close различает два разных факта, которые нельзя приравнивать:

- `CreditPurchases` — сумма реальных EXPENSE, оплаченных `Карта Credit`; используется в expense analytics;
- `ActualCreditSettlement` — сколько владелец фактически перечислил на кредитку при закрытии; это cash/liability settlement, а не второй EXPENSE.

`ActualCreditSettlement` может быть больше или меньше `CreditPurchases`. Такое расхождение само по себе не является reconciliation error.

Расходная аналитика:

```text
TotalExpenses =
    CreditPurchases
  + NegativePositions
  + VikaRed
```

Legacy денежный closing balance считается по фактическому settlement:

```text
ClosingBalance =
    PreviousClosingBalance
  + PositivePositions
  - NegativePositions
  - VikaRed
  - ActualCreditSettlement
```

Для legacy source `ActualCreditSettlement` разрешено извлекать только из доказанной close/service row `Кредитки` и её note K в доказанном close context. Если settlement evidence отсутствует или неоднозначно, нельзя автоматически подставлять `CreditPurchases`; значение остаётся unknown/review-required для close semantics.

System-managed PeriodClose использует только records с достаточно доказанной transaction granularity и period membership; исторические `PERIOD_AGGREGATE` не втягиваются в новый close engine автоматически.

## 12.1. Bootstrap первого system-managed периода

Цепочка `PreviousClosingBalance → ClosingBalance` должна иметь один подтверждённый anchor. PrihRash не обязан пересчитывать закрытия от 2018 года.

Перед первым system-managed period владелец подтверждает последнее надёжное значение `Текущий баланс` из legacy `Месячные` как opening balance следующего периода. Anchor хранит дату и provenance `LEGACY_CONFIRMED`.

## 13. Что делает старый workflow при закрытии

Legacy close — это ручной многошаговый процесс, а не один atomic edit. Владелец:

1. через Form создаёт шесть zero-amount expense service rows: `Плюсовые позиции`, `Кредитки`, `Минусовые позиции`, `Вика Красное`, `Возврат займа`, `Текущий баланс`;
2. заполняет K итоговыми/контрольными значениями; категория service rows не несёт финансового смысла и обычно выбирается только ради удобства Form;
3. для `Кредитки` K отражает фактически перечисленный `ActualCreditSettlement`, а не обязательное равенство сумме Credit purchases;
4. вручную массово меняет `Карта Credit → Карта Visa`, `Наличка → Карта Visa` и очищает `Вика=Да`;
5. рассчитывает `Текущий баланс`;
6. только после полного завершения этих действий визуально окрашивает шесть service rows — для владельца это означает «период официально закрыт».

Следовательно между первым и последним шагом источник может находиться в нормальном `CLOSE_IN_PROGRESS` состоянии. Snapshot, попавший в середину close, не должен автоматически превращать всю миграцию в permanent ambiguity: close-dependent interpretation откладывается до доказанного завершения, а независимые source rows могут продолжать синхронизироваться.

Color является подтверждённым owner workflow signal, но **не входит в physical adapter contract**, пока отдельный read-only provider audit не докажет exact formatting predicate. До такого proof код не читает/не угадывает цвет.

Credit/Cash/Vika cleanup нужен только legacy workflow и не является исправлением исходной истории. Новая система не должна выполнять такой cleanup вообще.

## 14. Legacy period-close markers

Legacy close/service rows концептуально включают markers:

- `Плюсовые позиции`;
- `Кредитки`;
- `Минусовые позиции`;
- `Вика Красное`;
- `Возврат займа`;
- `Текущий баланс`.

Это не Transactions. Exact physical spelling/placement и close-cluster predicate определяются `SOURCE_ADAPTER_CONTRACT` + R0 read-only evidence; conceptual label сам по себе не является достаточным source identity rule. Неподтверждённый zero/service row остаётся `NON_FINANCIAL`/`AMBIGUOUS`, а не угадывается как close marker.

Только доказанные close/service rows классифицируются как `LEGACY_PERIOD_CLOSE` и используются как migration/reference evidence.

## 15. Коррекция операции

До закрытия периода операция может свободно корректироваться.

После закрытия изменение операции должно:

1. показать, что затрагивается закрытый период;
2. показать влияние на итог;
3. после подтверждения пересчитать PeriodClose/создать корректировку закрытия.

История не должна молча меняться.

## 16. Analytics semantics

Календарный и расчётный периоды — разные аналитические измерения.

Нужно поддерживать:

- calendar ranges;
- actual FinancialPeriods;
- custom ranges;
- compare periods;
- drill-down.

Historical `PERIOD_AGGREGATE` нельзя включать в точные daily transaction counts/merchant-like drill-down без явного предупреждения. Monthly/yearly totals могут использовать его как coarse fact.

## 17. Plan ≠ Fact

Плановый платёж никогда не становится расходом сам по себе.

`Obligation`/`PlannedPayment` — ожидание/обязательство.

`Transaction` — свершившийся финансовый факт.

Связь между ними даёт `Plan vs Fact`.


## 18. Domain invariants v1

- EXPENSE: positive amount, expense category, one source account.
- INCOME: positive amount, income category, one destination account.
- TRANSFER: positive amount, distinct source/destination accounts, no category.
- `flow_kind` only for TRANSFER.
- VOIDED excluded from normal analytics/PeriodClose.
- EXCLUDED remains visible but excluded from measures/PeriodClose.
- V1 currency is RUB; FX/cross-currency operations are unsupported until a separate decision.
