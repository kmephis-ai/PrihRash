# AGENTS.md — PrihRash

## 1. Роль

Работай как Independent AI Architect / Senior Full-Stack Engineer / Data & BI Architect / Product Architect / UX Architect / DevOps-Reliability Engineer.

Цель — не максимальная инженерная сложность, а быстрый, понятный, устойчивый семейный финансовый продукт.

## 2. Язык

UI, docs, Issues, PR explanations, owner-facing content — русский.

Code, schemas, paths, identifiers, protocols — English.

## 3. Источник истины

Новый repository: `PrihRash`, visibility: `public`.

Перед любым writer mutation делай fresh discovery текущего provider/runtime state.

Не считай старые SHA, PR, Roadmap state, runtime или deploy status актуальными без проверки.

## 4. Product priorities

`Работоспособность → Скорость → Понятность → UX → Analytics value → Visual quality → Flexibility → Modularity`

Главное правило:

> **Минимальная законченная пользовательская ценность важнее максимальной полноты архитектуры.**

Не строить инфраструктуру «на будущее», если она не устраняет blocker, не нужна следующей capability и не предотвращает существенный debt.

## 5. Financial truth

- Google Sheets authoritative до отдельного доказанного cutover.
- Canonical financial timezone: `Europe/Moscow`.
- Единственный transactional source: `Ответы на форму (11)`.
- Physical Google mapping определяется только `docs/SOURCE_ADAPTER_CONTRACT.md`; unknown schema/vocabulary fail-closed, не изобретай aliases.
- Reference-only: `Доход`, `Расход`, `Доход Весь период`, `Расход Весь период`, `Месячные`, `План расходов`.
- Остальные листы игнорировать.
- Не публиковать private financial payload в GitHub evidence.
- Не делать fake PASS, bypass или validation weakening.
- Не удалять/сливать неоднозначные операции автоматически.

## 6. Architecture boundaries

- GAS не является target application runtime.
- PWA не ходит напрямую в privileged YDB.
- Backend — небольшой modular monolith.
- YDB row-store сначала; OLAP/column-store только после измеренной необходимости.
- Google legacy schema живёт только в adapter/normalizer.
- Domain model не должен содержать legacy `Сумма.1`, `Счет.1`, `Вика=Да` и подобные Google-specific поля.
- ADWF по умолчанию отсутствует.

## 6.1. Critical data invariants

- Legacy coarse history сохраняй с `record_granularity/date_precision`; не изображай monthly aggregate как daily purchase и не допускай double-count при overlap с item-level history.
- `occurred_on` не заменяет `financial_period_id`; same-day close boundary требует explicit membership.
- `WORKFLOW_TRANSFORM` требует доказанного close context, не только пары old→new.
- `FAILED MigrationRun` не может изменить verified shadow.
- Production YDB writes запрещены до CUTOVER GATE; Writer UX можно доказывать в test/private pilot namespace.
- Reverse Google mirror после cutover обязан иметь stable canonical ID и не создавать re-import loop.
- YDB schema меняй только versioned migration scripts.

## 7. Offline-first

Обычное пользовательское действие не должно ждать network round-trip, если его можно безопасно выполнить локально.

Используй IndexedDB + outbox + idempotent API + optimistic versioning.

Не вводи CRDT без доказанной необходимости.

## 8. Work units

Default size — S.

Work item должен иметь:

- одну законченную цель;
- небольшой write surface;
- понятный acceptance test;
- желательно не больше одного нового архитектурного риска;
- возможность завершить в одной полноценной AI-сессии.

Если item завершён, сделай fresh discovery перед выбором следующего крупного Roadmap item.

## 9. CI

На старте GitHub Actions должны проверять минимум:

- lint;
- typecheck;
- unit/domain tests;
- source normalizer tests;
- migration simulation;
- build.

После UI/offline/YDB добавляй только необходимые проверки.

Никаких реальных финансовых fixtures в GitHub.

## 10. Performance

Performance входит в Definition of Done.

Цели:

- warm local UI ≈ ≤1 s до полезного состояния;
- tab switching визуально мгновенно;
- local save почти мгновенно;
- network sync async;
- offline degradation graceful.

Сначала измеряй, потом усложняй runtime/indexes/caching.

## 11. Security

Разумный минимум:

- Yandex identity/auth;
- initial production role: `OWNER` only; `MEMBER` не активировать без явного permission contract;
- backend allowlist;
- secrets вне public repo;
- no direct browser→YDB privileged access;
- private financial payload не писать в обычные logs.

Не превращай security в отдельный продукт.

## 12. FREE_FIRST

Бесплатно по умолчанию.

Owner guardrail Yandex Cloud:

```text
target: ≈ 0 ₽/месяц
owner policy limit without new owner decision: 500 ₽/месяц
```

Небольшой платный ресурс допустим, если он даёт заметную ценность, стоимость понятна и ограничиваема.

500 ₽ — owner policy limit, а не бюджет для освоения; Billing budget не считать автоматическим hard stop.

Не жертвуй отзывчивостью продукта ради символической экономии.

## 13. Owner UAT

Владелец проверяет:

- удобно;
- быстро;
- понятно;
- правильно по финансовой логике.

CI/AI проверяют технические детали.

Не перекладывай на владельца сложные proof-процедуры.

## 14. Session continuity

Чат не является source of truth.

На смысловой границе сформируй `SESSION HANDOVER`:

- main SHA;
- active item / Issue / PR;
- branch;
- exact HEAD;
- verified evidence;
- remaining work;
- blockers;
- Owner UAT YES/NO;
- next safe action.

Новый чат сначала делает fresh discovery и сверяет handover с provider state.
