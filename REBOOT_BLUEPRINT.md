# PrihRash Reboot Blueprint v1.4

## 1. Зачем нужен перезапуск

Предыдущие попытки развития PrihRash накопили слишком много процессной, интеграционной и инфраструктурной сложности относительно реальной пользовательской ценности. Новый старт должен быть чистым: новый репозиторий, минимальный набор правил, небольшие законченные work items и быстрый выход к реально работающему продукту.

Главная цель перезапуска — не «переписать старое красивее», а построить долговечную модель семейных финансов, которая сначала решает ежедневные задачи быстро и надёжно, а затем постепенно превращается в персональную BI/OLAP-платформу.

## 2. Product identity

> **Локально-отзывчивый семейный финансовый PWA с надёжным журналом операций, постепенно превращающийся в персональную BI/OLAP-платформу. Простой сверху. Сильный внутри. Мгновенный локально. Надёжный в данных. Аналитический по архитектуре, но не перегруженный аналитикой до появления достаточных данных.**

PrihRash должен совмещать два режима:

- **Simple:** быстро понять, что произошло, сколько осталось, что требует внимания, быстро внести операцию;
- **Expert:** фильтровать и исследовать данные, сравнивать периоды, строить разрезы, редактировать операции, сохранять представления и делать drill-down до фактов.

Оба режима используют одну финансовую истину.

## 3. Приоритеты продукта

Порядок приоритетов:

`Работоспособность → Скорость → Понятность → UX → Analytics value → Visual quality → Flexibility → Modularity`

Ключевое правило разработки:

> **Минимальная законченная пользовательская ценность важнее максимальной полноты архитектуры.**

Дополнительный принцип:

> **Future-compatible, not future-implemented.**

Архитектура должна позволять расширение, но будущие QR, bank import, AI classification, сложный OLAP и другие идеи не должны реализовываться до появления реальной необходимости.

## 4. Новый репозиторий

Перезапуск должен происходить в новом чистом репозитории. Старый `PrihRashOnline-v2` не должен служить каркасом для третьей версии.

Не переносить автоматически:

- старую историю коммитов;
- старые PR и Issues;
- старые lifecycle/governance механизмы;
- старый Apps Script runtime как основу продукта;
- ADWF как обязательную часть репозитория;
- старый огромный `AGENTS.md`.

Разрешено переносить только осознанно выбранные знания и проверенные контракты из этого Reboot Pack.

ADWF по умолчанию **не установлен**. Он может появиться только если реальная повторяющаяся проблема докажет, что GitHub + Actions + короткий `AGENTS.md` недостаточны.

## 4.1. Зафиксированные стартовые параметры

```text
repository: PrihRash
visibility: public
financial_timezone: Europe/Moscow
yandex_cloud_target_cost: ≈ 0 ₽/month
yandex_cloud_owner_policy_limit: 500 ₽/month
```

`500 ₽/month` — owner policy limit, а не технически гарантированный stop-loss. Yandex Cloud Budget используется для уведомлений и сам по себе не останавливает потребление. Ресурсы должны дополнительно иметь доступные provider caps/quotas/scaling limits; конфигурация с ожидаемой стоимостью выше 500 ₽/месяц требует нового owner decision.

Public repo означает: никакие реальные финансовые payload, credentials, tokens, private identifiers и production secrets не попадают в GitHub evidence или fixtures.

## 5. Источник данных

Исходная Google-таблица: `ПрихРасхOnline`.

### Единственный authoritative transactional source

`Ответы на форму (11)`

Только этот лист содержит исходные финансовые операции для миграции.

Точная позиционная схема A–K, stable adapter keys, подтверждённый source vocabulary и fail-closed schema-drift policy зафиксированы в `docs/SOURCE_ADAPTER_CONTRACT.md`. Adapter не должен угадывать duplicate headers или aliases.

### Reference-only листы

- `Доход` — образец аналитики доходов;
- `Расход` — образец аналитики расходов;
- `Доход Весь период` — историческая аналитика доходов;
- `Расход Весь период` — историческая аналитика расходов;
- `Месячные` — образец/оракул текущего закрытия расчётного периода;
- `План расходов` — образец плановых/повторяемых обязательств.

Эти листы **никогда не создают canonical Transactions**.

Все остальные листы должны игнорироваться как не относящиеся к PrihRash.

## 6. Миграционная стратегия authority

Переход выполняется без big-bang cutover.

### Stage A — Google authoritative

Google Sheets остаётся единственной финансовой истиной. Новый код только читает.

### Stage B — YDB shadow

Google остаётся authoritative. YDB получает автоматическую shadow-копию через normalizer и reconciliation.

### Stage C — приложение читает YDB

PWA читает в основном YDB для скорости, но Google остаётся authority/fallback.

### Stage D — YDB authoritative

Новые операции создаются в YDB/PWA. Google поддерживается автоматическим compatibility mirror. Reverse mirror обязан быть loop-safe: YDB-authored row получает стабильный canonical `transaction_id` в зарезервированном техническом Google metadata field; importer видит этот marker как reconciliation/ack и никогда не создаёт из зеркальной строки вторую Transaction. Unmarked новая Form row может работать как fallback input только в явно включённом compatibility mode; ручная правка marked mirror row после cutover считается drift/review, а не новой authority.

### Stage E — Google как fallback/export

Google больше не является operational authority, но остаётся рабочим резервным представлением/экспортом и частью recovery-плана.

Каждый переход между стадиями требует доказательств. Нельзя объявлять cutover потому, что «вроде работает».

## 7. Основная domain model

### Transaction

```text
Transaction

id: UUID

type:
  EXPENSE | INCOME | TRANSFER

occurred_on: Date
captured_at: Timestamp?

record_granularity:
  TRANSACTION | PERIOD_AGGREGATE | UNKNOWN

date_precision:
  DAY | MONTH | UNKNOWN

aggregate_period_month: Date?

financial_period_id: UUID?
period_assignment_quality:
  EXPLICIT | DERIVED | LEGACY_AMBIGUOUS | UNASSIGNED

amount_minor: Int64
currency: string

from_account_id: UUID?
to_account_id: UUID?

category_id: UUID?
paid_by_member_id: UUID?

description: string?
note: string?

status:
  POSTED | VOIDED

analytics_state:
  INCLUDED | EXCLUDED

flow_kind?:
  OWN_FUNDS_TRANSFER | CREDIT_DRAW | CREDIT_REPAYMENT

created_at
updated_at
version
```

`captured_at` хранится только когда реальное время capture доказуемо. Для legacy Google history оно может быть `null`; raw source datetime сохраняется в provenance, но не выдаётся за точное время capture.

`record_granularity=PERIOD_AGGREGATE` означает: это исторический финансовый факт низкой детализации, который участвует в корректных агрегатах, но не должен отображаться как отдельная покупка конкретного дня. `aggregate_period_month` используется только для доказанного месячного агрегата.

`financial_period_id` отвечает за принадлежность к расчётному циклу и не заменяется выводом только из календарной даты. Это принципиально для операций в день фактического закрытия. Для imported production legacy data до появления `financial_periods` в R4 поле остаётся `null`/`UNASSIGNED`; R0–R2 не создают ссылки на несуществующие periods.

`flow_kind` используется только когда появляется реальная необходимость отличить экономический смысл TRANSFER. `Transaction.type` не должен разрастаться в бухгалтерский справочник.

### Domain invariants v1

```text
EXPENSE:
  amount_minor > 0
  from_account_id != null
  to_account_id = null
  category.kind = EXPENSE

INCOME:
  amount_minor > 0
  from_account_id = null
  to_account_id != null
  category.kind = INCOME

TRANSFER:
  amount_minor > 0
  from_account_id != null
  to_account_id != null
  from_account_id != to_account_id
  category_id = null

flow_kind:
  allowed only for TRANSFER

VOIDED:
  excluded from normal analytics and PeriodClose

analytics_state=EXCLUDED:
  financial fact remains visible
  excluded from measures and PeriodClose
```

V1 поддерживает только `RUB`. Поле `currency` сохраняется в модели для долговечности, но cross-currency operations/FX до отдельного решения запрещены.

### Account

```text
Account

id
name
kind:
  CASH | DEBIT_CARD | CREDIT_CARD | BANK_ACCOUNT | SAVINGS | OTHER | UNKNOWN
balance_nature:
  ASSET | LIABILITY | UNKNOWN
currency
status:
  ACTIVE | ARCHIVED
```

### Category

```text
Category

id
name
kind:
  EXPENSE | INCOME
parent_id?
status:
  ACTIVE | ARCHIVED
sort_order?
```

Историческую таксономию источника сохраняем без автоматического слияния/«улучшения».

### FamilyMember

```text
FamilyMember

id
name
status
```

`FamilyMember` и пользователь приложения — разные понятия. Человек может фигурировать в операциях, не имея доступа к PWA.

### AppUser

```text
AppUser

id
external_subject
family_member_id?
role
status
```

## 8. Семантика оплаты и Вики

Старый источник использует три основных инструмента оплаты:

- `Карта Visa` — дебетовая;
- `Карта Credit` — кредитная;
- `Наличка` — наличные.

Поле `Вика=Да` означает: расход оплатила Вика **наличными или дебетовой картой**. Если Вика платит кредиткой, галочка не используется и расход оформляется как обычный `Карта Credit`.

Следовательно:

- `Вика=Да` достоверно означает `paid_by_member=Вика`;
- пустое поле `Вика` **не означает**, что расход точно не Вики;
- исторические Credit-расходы Вики могут быть неотличимы от остальных Credit-расходов.

Новая PWA должна хранить `paid_by_member_id` независимо от счёта, чтобы эта потеря информации больше не происходила.

## 9. Расчётный период

14-е число — текущий целевой расчётный день, но это **настройка**, а не константа.

```text
FinanceProfile
  target_close_day = 14
  timezone = Europe/Moscow
```

`FinanceProfile` хранится в YDB уже в initial schema как небольшой canonical configuration record. Редактирование `target_close_day` появляется вместе с R4, но timezone и текущее значение 14 не живут только в env/config.

Расчётный период определяется фактическими событиями закрытия. Поскольку закрытие иногда сдвигается, нельзя жёстко считать период как «15→14».

Календарная дата и membership в расчётном периоде — разные понятия. `occurred_on` отвечает на вопрос «когда произошла операция по календарю», а `financial_period_id` — «в какой расчётный цикл она вошла».

После активации FinancialPeriod capability (R4) для новых PWA-операций:

1. при capture в OPEN period операция получает его `financial_period_id`;
2. close фиксирует границу и открывает следующий period;
3. операция, созданная после close в тот же календарный день, относится уже к новому period;
4. поздний ввод с датой прошлого закрытого периода требует явного выбора/подтверждения пересчёта прошлого period;
5. нельзя определять membership только выражением `occurred_on <= close_date`.

Для legacy history, где точный membership на дате close недоказуем, используется `period_assignment_quality=LEGACY_AMBIGUOUS` или `UNASSIGNED`; миграция не должна угадывать.

Каждый закрытый период хранит свои реальные границы. Изменение `target_close_day` влияет только на будущие периоды и напоминания.

### Late entry

Операция может быть внесена через несколько дней. `occurred_on` остаётся финансовой бизнес-датой; `captured_at` хранится только при доказуемом capture time.

Если пользователь указывает дату, относящуюся к уже закрытому периоду, PWA показывает affected PeriodClose и preview изменения результата. Нельзя молча отнести такую операцию в новый период только потому, что она введена позднее.

## 10. Формула закрытия периода

Текущий ручной механизм доказан на листе `Месячные`.

Расходы периода раскладываются по трём непересекающимся settlement buckets:

1. `CreditCards` — все расходы, оплаченные `CREDIT_CARD`, независимо от плательщика;
2. `VikaRed` — расходы Вики, оплаченные не кредиткой;
3. `NegativePositions` — остальные расходы периода.

Доходы периода:

`PositivePositions = сумма INCLUDED INCOME`.

Формула:

```text
ClosingBalance =
    PreviousClosingBalance
  + PositivePositions
  - CreditCards
  - NegativePositions
  - VikaRed
```

Equivalent invariant:

```text
TotalExpenses = CreditCards + NegativePositions + VikaRed
ClosingBalance = PreviousClosingBalance + TotalIncome - TotalExpenses
```

Если buckets не покрывают все INCLUDED EXPENSE ровно один раз, закрытие запрещено. System-managed PeriodClose принимает только records с достаточной transaction granularity и доказанным period membership; старые `PERIOD_AGGREGATE` не включаются автоматически.

### Возврат займа 100 000 ₽

Ежемесячный беспроцентный перевод 100 000 ₽ с кредитной карты:

- получение не является доходом;
- возврат не является расходом;
- это движение заёмной ликвидности/обязательства;
- строка `Возврат займа 100000` в старом закрытии — напоминание, а не часть формулы.

В будущем это должно стать `Obligation`/контрольной задачей, а не `PeriodCloseMetric`, влияющей на баланс.

## 11. PeriodClose

Закрытие периода — отдельный domain object. Оно не переписывает Transactions.

```text
FinancialPeriod
  id
  sequence_no
  target_close_day_snapshot
  opened_at
  closed_at?
  opening_balance_minor
  status: OPEN | READY_TO_CLOSE | CLOSED

PeriodClose
  id
  financial_period_id
  positive_positions_minor
  credit_cards_minor
  negative_positions_minor
  vika_red_minor
  closing_balance_minor
  closed_at
  revision
```

### Bootstrap anchor

Рекурсивная цепочка балансов должна иметь один доказанный стартовый anchor. Не требуется пересчитывать её от 2018 года.

Перед первым system-managed PeriodClose владелец подтверждает последнее надёжное legacy закрытие из `Месячные` как bootstrap:

```text
first_system_period.opening_balance_minor
bootstrap_source = LEGACY_CONFIRMED
bootstrap_close_date
```

После этого:

`Opening[n+1] = Closing[n]`.

На первом этапе PeriodClose гибридный: система считает автоматически, пользователь проверяет decomposition и подтверждает закрытие. Если поздняя correction затрагивает CLOSED period, старая версия результата не переписывается молча — создаётся новая revision/явный пересчёт.

В старом процессе после закрытия вручную выполняется `Credit/Cash → Visa` и очистка `Вика=Да`. Это spreadsheet cleanup, а не изменение фактической истории. В новой системе такие действия не нужны.

## 12. Аналитика

Первая аналитика может воспроизводить привычную логику листов `Доход`, `Расход`, `... Весь период`, но должна строиться из canonical Transactions.

Минимальный Analytics Explorer:

- произвольный диапазон дат;
- текущий/предыдущий расчётный период;
- календарный месяц/год;
- произвольный пользовательский период;
- доходы, расходы, разница;
- grouping по category/account/member;
- доля категории;
- количество операций;
- сравнение периодов;
- drill-down до исходных операций.

Ключевой принцип:

> Каждая аналитическая цифра должна быть проверяема через canonical facts, из которых она рассчитана.

Для `record_granularity=PERIOD_AGGREGATE` drill-down показывает честную пометку «исторический агрегат», а не вымышленную покупку конкретного дня. Такие records участвуют в корректных monthly/yearly totals, но исключаются из точной daily/transaction-count аналитики, если метрика требует детализации, которой источник не содержит. Aggregate и item-level records одного covered period/category нельзя суммировать вместе без доказанной additive semantics. Ordinary transaction editor не редактирует их как обычную покупку; correction идёт через expert/reconciliation flow с явным пониманием coarse semantics.

Визуализация — последний слой:

`Transactions → Filterable Dataset → Measures → Group/Compare → Drill-down → Saved View → Visualization`.

Не создавать второй dashboard engine.

## 13. Data Explorer

Новая система обязана сохранить сильную сторону таблицы: возможность самостоятельно исследовать и исправлять данные.

Expert-режим `Операции` должен постепенно получить:

- таблицу на desktop и карточки на mobile;
- сортировку;
- поиск;
- фильтры;
- выбор произвольного периода;
- фильтры по account/category/member/type/note;
- сохранённые представления;
- редактирование операции;
- CSV export;
- позже XLSX export.

Если операция относится к закрытому периоду, перед сохранением показывается влияние на PeriodClose и требуется явное подтверждение пересчёта.

## 14. Примечания и контексты

`note` остаётся свободным текстом.

В нём реально используются:

- ссылки на покупки;
- пробег автомобиля;
- пояснения;
- временные аналитические метки (`Море 2024`, поездки, события и т.д.).

Не надо сейчас превращать note в жёсткую структуру. В будущем поверх него могут появиться `Tag/Context`, но исходный текст сохраняется.

## 15. Чеки и QR — будущее, не старт

Сегодня один чек может вручную раскладываться на несколько расходов, например:

- Продукты 2334;
- Алкоголь 667.

Будущий QR-flow должен поддержать эту семантику:

`Receipt → ReceiptItems/Allocations → несколько category allocations/transactions`.

При QR/enrichment нужно стремиться сохранить максимум действительно доступного фактического контекста: merchant/place, purchase date/time, fiscal identifiers, позиции чека, количества/цены и другие полезные receipt fields. Это enrichment финансового факта, а не повод заранее строить универсальную ingestion-платформу.

Но QR не входит в первые релизы. Сначала нужно доказать быстрый ручной ввод, offline sync и корректную финансовую модель.

## 16. План расходов

`План расходов` — reference для будущего planning layer.

Будущая модель должна поддерживать:

- регулярные платежи с меняющейся суммой;
- регулярные платежи с известной/примерной суммой;
- одноразовые плановые платежи;
- рассрочки;
- платежи, которые появляются в одном месяце и исчезают в другом;
- связь `план → фактическая Transaction`;
- checklist перед PeriodClose;
- `План vs Факт`.

Рабочая будущая сущность: `Obligation`/`PlannedPayment`. Она **не входит** в первый data-foundation release.

## 17. Offline-first PWA

Использовать Offline Lite, а не CRDT/distributed DB.

IndexedDB хранит:

- reference data;
- recent transactions;
- current financial period;
- drafts;
- outbox;
- sync metadata;
- user preferences.

### Read

- UI сразу рендерится из IndexedDB;
- API обновляет данные в фоне;
- сетевой round-trip не должен блокировать обычное чтение.

### Write

- client генерирует UUID;
- операция сразу сохраняется локально;
- UI подтверждает сохранение мгновенно;
- outbox синхронизируется позже;
- backend idempotent;
- повторный запрос с тем же ID не создаёт дубль.

### Edit

- optimistic version;
- conflict → явное сравнение локальной и серверной версии;
- без CRDT.

### Delete

Пользовательское «удалить» → `VOIDED`, не физический delete.

## 18. Runtime direction

GAS не является целевой платформой приложения.

Предпочтительная рабочая архитектура:

```text
PWA
  ↓ HTTPS
API Gateway
  ↓
Yandex Serverless Container
  ↓
modular monolith (TypeScript/Node.js)
  ↓
YDB Serverless
```

Serverless Container — основной кандидат для API, потому что приложение естественно является небольшим HTTP backend, а стабильность и отзывчивость важнее минимального числа компонентов.

Cloud Functions допустимы для коротких фоновых jobs, если это реально проще.

### Собственный домен

У владельца есть `mepnet.ru`, зарегистрированный у REG.RU. Домен полезен как стабильная пользовательская граница и не должен зависеть от конкретного cloud-generated hostname. Предпочтительная стартовая схема:

- `prih.mepnet.ru` — PWA;
- `api.mepnet.ru` — API.

REG.RU/DNS можно оставить как есть и направить поддомены в Yandex Cloud. Перенос DNS/delegation в Yandex Cloud не является обязательным условием запуска. Конкретный static hosting/CDN path выбирается коротким spike по latency, HTTPS, cache behavior и стоимости.

### Яндекс Плюс

Активная подписка Яндекс Плюс может быть удобна владельцу как часть Yandex ecosystem, но она **не учитывается как Cloud-бюджет или Cloud entitlement**, пока это не подтверждено официальными условиями. Yandex Cloud планируется и лимитируется отдельно.

Prepared/min instance не включается «по вере»: сначала измеряется cold/warm latency. Если cold start ухудшает UX, допускается небольшой предсказуемый расход ради постоянной готовности.

## 19. Auth и безопасность

Авторизация — через экосистему Яндекса/поддерживаемый Yandex identity flow.

Не строить собственную password system.

Разумный минимум:

- API не анонимный;
- backend проверяет identity;
- небольшой allowlist разрешённых AppUsers;
- production secrets не лежат в public GitHub;
- финансовые payload не пишутся в обычные logs;
- browser не получает прямой привилегированный доступ к YDB;
- первая production-роль — только `OWNER`; этого достаточно для R0–R4 owner-only использования;
- `MEMBER` зарезервирован как будущая роль, но не активируется до явного permission contract. Нельзя молча придумать права второго пользователя.

Security не должен превращаться в отдельную многомесячную программу.

## 20. Performance

Performance — часть Product Ready.

Цели:

- warm open → полезный локальный UI примерно ≤ 1 секунды;
- tab switching → визуально мгновенно;
- local save → практически мгновенно;
- network sync → вне critical path;
- временная недоступность backend не мешает открыть приложение, посмотреть recent data и добавить новую операцию offline.

Нужно измерять, а не предполагать.

## 21. YDB

На старте использовать row-oriented OLTP tables. Не строить OLAP/column-store только из-за будущей BI vision.

Минимальный physical foundation:

- `transactions`;
- `accounts`;
- `categories`;
- `family_members`;
- `finance_profiles`;
- `source_records`;
- `source_record_revisions`;
- `source_snapshots`;
- `migration_runs`;
- `schema_migrations`.

Не создавать speculative secondary indexes в R0/R1. Перед R2 production Reader обязательно измерить `recent transactions` и date-range queries; если full scan мешает latency/cost target, добавить ровно один доказанный index/read projection.

## 22. Migration principles

Google row ≠ Transaction.

Всегда:

`Google row → SourceRecord → Normalizer → canonical Transaction`.

Никогда не копировать legacy columns напрямую в domain model.

Known cleanup pairs:

- `Вика=Да → blank`;
- `Карта Credit → Карта Visa`;
- `Наличка → Карта Visa`.

**Сама пара old→new не доказывает WORKFLOW_TRANSFORM.** Sticky preservation разрешён только при контексте закрытия: есть successful pre-close observation, операция относится к только что закрытому period, обнаружен close event/legacy close markers, изменение наблюдается после close и изменённые поля совместимы с known cleanup pattern. Иначе изменение считается OWNER_CORRECTION либо fail-closed `AMBIGUOUS_CHANGE`.

Обычные исправления amount/category/date/description/note — owner corrections и обновляют canonical Transaction.

Структурно опасные изменения (`EXPENSE↔INCOME`, positive→0, исчезновение строки, сложный reorder) fail-closed и требуют reconciliation/review. `MISSING/AMBIGUOUS` должны иметь явное resolution action; они не могут бесконечно считаться «разобранными» только потому, что importer продолжает работать.

### Shadow promotion invariant

`MigrationRun=FAILED` не имеет права изменить observable verified shadow. Candidate projection строится и валидируется до mutation текущего state. Обычный небольшой delta применяется одной атомарной YDB transaction вместе с commit marker. Если delta не помещается в заранее проверенный safe promotion limit, sync fail-closed (`PROMOTION_TOO_LARGE`) и использует отдельный controlled rebuild/staging path; partial promotion запрещён.

### Schema evolution

Любое изменение YDB schema идёт только через versioned migrations:

```text
db/migrations/001_initial.sql
db/migrations/002_...sql
schema_migrations(version, checksum, applied_at)
```

Manual production-only DDL запрещён.

## 23. FREE_FIRST

Бесплатно по умолчанию.

Owner policy limit Yandex Cloud: стремиться к `≈0 ₽/month`; конфигурация, ожидаемо способная превысить `500 ₽/month`, требует нового owner decision. Billing budget — только уведомление, поэтому по возможности применяются resource caps/quotas/max instances и alerts.

Небольшая платная стоимость допустима, если:

- даёт очевидную продуктовую ценность;
- предсказуема;
- есть понятный верхний предел или технический cap;
- особенно оправдана для отзывчивости/надёжности.

Нельзя превращать FREE_FIRST в догму, заставляющую терпеть плохой UX ради символической экономии.

## 24. Development model

Новый проект работает небольшими S-sized work units.

Хороший item:

> Expense normalizer корректно преобразует synthetic Google rows в canonical Transaction и покрыт тестами.

Плохой item:

> Построить migration platform.

Один item должен иметь:

- одну законченную цель;
- небольшой write surface;
- чёткий acceptance test;
- желательно не больше одного нового архитектурного риска;
- возможность закончить за одну полноценную AI-сессию.

## 25. GitHub Actions

Начальный CI:

- lint;
- typecheck;
- unit/domain tests;
- source normalizer tests;
- migration simulation;
- build.

После UI:

- component tests;
- Playwright critical flows.

После offline:

- offline create;
- outbox replay;
- idempotency;
- conflict tests.

После YDB:

- adapter integration на synthetic/test database.

Никаких реальных финансовых fixtures в GitHub.

## 26. Owner UAT

Owner проверяет продукт, а не инфраструктуру.

Owner UAT отвечает на вопросы:

- быстро ли;
- понятно ли;
- удобно ли;
- правильно ли отражена финансовая логика;
- достаточно ли мало действий.

Owner не обязан проверять SHA, internal logs, lock files, API contracts или вручную выполнять сложные доказательные сценарии.

## 27. Observability

Минимум:

- structured logs;
- request id;
- migration_run_id;
- error code;
- latency.

По умолчанию не логировать:

- amount;
- description;
- raw note;
- full category/name payload;
- raw Google row.

## 28. Backup и recovery

Пока Google authoritative — Google является основным recovery source.

Перед YDB-authoritative cutover необходимо доказать:

- YDB backup;
- хотя бы одну реальную restore-процедуру;
- YDB→Google compatibility mirror;
- возможность временно вернуть Google-authoritative mode.

Backup считается реальным только после доказанного восстановления.

## 29. Первый пользовательский UI

Верхнеуровневая навигация:

- `Главная`;
- `Операции`;
- `Аналитика`;
- `Ещё`.

Не размножать top-level screens.

### Главная

- текущий расчётный период;
- доходы;
- расходы;
- расчётный остаток;
- до планового закрытия N дней;
- последние операции;
- pending sync;
- быстрый `+ Добавить`.

### Быстрый расход

По умолчанию только самое нужное:

- сумма;
- категория;
- счёт;
- описание.

Дополнительное через progressive disclosure:

- дата;
- кто платил;
- note.

## 30. Release path

### R0 — Data Foundation Proven

`Google read-only → parser → granularity/date-quality classifier → normalizer → canonical model → reconciliation`.

Без UI, YDB authority changes и без ложной детализации старой истории.

### R1 — YDB Shadow Proven

Shadow sync работает стабильно, сохраняет transient semantics, имеет доказанный atomic promotion protocol и проходит reconciliation. Один реальный расчётный цикл остаётся production gate, но параллельная разработка Reader/Writer UX на synthetic/candidate data разрешена.

### R2 — Reader

Минимальная read-only PWA читает YDB, открывается быстро, показывает операции и базовые итоги. До полноценного FinancialPeriod engine допускается `LegacyCurrentPeriodProjection` только как **неавторитетный preview** с явным provisional label. Он не используется для PeriodClose/authority decisions и скрывается, если importer не может однозначно определить post-close working set.

### R3A — Writer UX Proven (не production authority)

Offline manual entry → IndexedDB/outbox → idempotent API в synthetic/test/private pilot namespace. Доказываются UX, retries, conflicts и VOID semantics. `YDB_WRITE_ENABLED=false` для production financial truth.

### R4 — Financial Period / Close

Configurable target day, explicit period membership, bootstrap anchor, PeriodClose decomposition, correction/revision и отказ от legacy cleanup.

### CUTOVER GATE — Stage D

До YDB-authoritative product/Writer writes обязаны быть доказаны: несколько real shadow cycles, loop-safe reverse Google compatibility mirror с stable canonical ID, restore/fallback, idempotency/conflicts, owner usage Reader, отсутствие unexplained high-impact mismatch и controlled cost. R1 shadow/migration writes в YDB выполняются раньше как replication path и не меняют Google authority.

### R3B — Production Writer / YDB authoritative

Только после CUTOVER GATE PWA создаёт authoritative Transactions в YDB; Google получает compatibility mirror.

### R5 — Familiar-first Analytics

Arbitrary periods, compare, grouping, drill-down, expert table, export и честное отображение historical granularity.

### R6 — Planning / Obligations

Recurring/one-time obligations, variable/unknown amounts, link `plan → fact`, Plan vs Fact и checklist.

QR, receipts, advanced AI classification, complex OLAP — только после доказанной ценности предыдущих этапов.

## 31. Явные non-goals на старте

Не строить:

- microservices;
- event sourcing;
- CRDT;
- Kafka/CDC;
- универсальный ingestion framework;
- universal Capture domain object;
- сложный IAM/RBAC;
- собственный auth server;
- ADWF governance layer;
- второй dashboard engine;
- column-store без доказанной аналитической нагрузки;
- AI auto-classification, silently rewriting financial semantics;
- QR receipt pipeline до доказанного manual/offline flow.

## 32. Критерий хорошего старта

Новый PrihRash начинает правильно, если через первые несколько небольших релизов владелец получает:

1. доказуемо правильную canonical копию реальных операций;
2. быстрый read-only интерфейс;
3. затем более удобный ввод, чем Google Form;
4. затем автоматическое, объяснимое закрытие расчётного периода;
5. затем гибкую аналитику, не хуже привычных таблиц и постепенно сильнее их.

Если несколько недель проходят без видимого пользовательского результата и без обязательной миграционной причины, roadmap должен быть пересмотрен.
