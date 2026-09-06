# Start Readiness — что должно быть зафиксировано перед новым стартом

Этот документ — последний gate между Concept Freeze и разработкой. Он не добавляет новую архитектуру. Его задача — не позволить новому чату или разработчику молча додумать важные параметры.

## Статус концепции

**Concept Freeze: READY. R0 implementation: GO.** Следующие milestones имеют собственные gates; этот статус не разрешает преждевременный production shadow или authority cutover.

Owner Review закрыт полностью. Все финансовые решения, правила миграции и продуктовые границы подтверждены владельцем. Новые продуктовые сущности или framework-слои до появления реальной потребности не добавляются.

## Что уже можно считать решённым

- новый чистый репозиторий;
- Google `Ответы на форму (11)` сначала authoritative;
- YDB сначала shadow;
- PWA local-first/offline-lite;
- Yandex ecosystem для runtime/auth;
- `mepnet.ru` можно использовать как стабильный продуктовый домен;
- ADWF по умолчанию отсутствует;
- financial semantics и Period Close определены;
- source row `MISSING` не удаляет Transaction автоматически;
- exact duplicates не удаляются автоматически;
- старые cleanup-преобразования `Credit/Cash → Visa` и `Вика=Да → blank` не должны уничтожать уже наблюдённую исходную семантику.

## Owner-level стартовые параметры — ЗАФИКСИРОВАНЫ

### 1. Финансовая часовая зона

Canonical financial timezone:

```text
Europe/Moscow
```

Она хранится в `FinanceProfile` и определяет финансовые даты, границы дня и close events. Timezone текущего телефона/ноутбука не меняет финансовую семантику.

Если timezone когда-либо меняется, это отдельное owner decision для будущих периодов; исторические периоды не переписываются молча.

### 2. Yandex Cloud cost guardrail

```text
target: стремиться к 0 ₽/месяц
owner policy limit: 500 ₽/месяц
```

До 500 ₽/месяц допустимо только при понятном обосновании реальной пользы: заметная отзывчивость, стабильность, backup/recovery или другая измеримая продуктовая ценность.

500 ₽ — не бюджет, который нужно использовать, а owner policy limit. Yandex Cloud Budget не является автоматическим stop; нужны доступные resource caps/quotas/max instances и уведомления. Конфигурация с ожидаемой стоимостью выше лимита требует нового owner decision.

### 3. Новый GitHub repository

```text
name: PrihRash
visibility: public
```

Версия относится к продукту (`0.x`, `1.x`), а не к имени репозитория.

Поскольку repository public:

- никаких реальных финансовых payload;
- никаких Google/Yandex credentials или tokens;
- никаких production secrets;
- никаких приватных идентификаторов в evidence;
- никаких реальных financial fixtures в Issues/PR/Actions artifacts.

Только synthetic fixtures и безопасные агрегированные статусы.


## Что НЕ требует решения владельца до старта

Следующие пункты должен выбрать AI/архитектор через короткий spike/measurement, а не перекладывать на владельца:

- точный современный Yandex auth flow;
- Serverless Container cold/warm policy и нужен ли `min_instances=1`;
- Cloud Function или container entry point для scheduled Google sync;
- точный PWA hosting path;
- secondary indexes/read projections YDB;
- конкретный frontend framework/build tool;
- QR provider/enrichment в будущем.

Все они обязаны сохранять уже утверждённые продуктовые границы.

## До первого commit нового repo

Должны существовать и быть прочитаны **нормативные** документы:

1. `REBOOT_BLUEPRINT.md`;
2. `AGENTS.md`;
3. `docs/FINANCIAL_SEMANTICS.md`;
4. `docs/SOURCE_ADAPTER_CONTRACT.md`;
5. `docs/MIGRATION_CONTRACT.md`;
6. `docs/ROADMAP.md`;
7. `docs/START_READINESS.md`;
8. закрытый `docs/OWNER_REVIEW_CHECKLIST.md`.

Audit/review документы сохраняют rationale, но не являются отдельным source of truth и не могут переопределять нормативные контракты.

Первый commit не должен содержать Yandex/YDB deployment infrastructure. Сначала минимальный TypeScript/project skeleton, CI и synthetic financial fixtures.

## Read-only real-data discovery в R0

Ранний **discovery probe** разрешён до полного normalizer-а и нужен для проверки тех вещей, которые нельзя честно придумать из synthetic data:

- exact spreadsheet identity задаётся приватной runtime/config переменной;
- доступ только read-only;
- adapter reader сначала проходит synthetic header/schema fixture;
- затем можно проверить physical headers/order/vocabulary и representative private windows;
- discovery probe ничего не пишет в YDB/Google и не публикует raw payload;
- реальные строки, суммы, description/note не попадают в GitHub/Actions/artifacts.

Цель discovery probe — получить доказательства для `SOURCE_ADAPTER_CONTRACT` и historical classification rules, а не создать production import.

### До full-data canonical normalization

Перед прогоном полного source через normalizer:

- EXPENSE/INCOME mapping доказан synthetic fixtures;
- zero/service/duplicate/unknown-vocabulary cases fail-closed;
- granularity rules, полученные из private discovery, перенесены в synthetic tests без real payload;
- reconciliation output безопасен и не содержит private financial details.


## До первого production shadow sync

Нужно доказать:

- initial full snapshot;
- deterministic lineage/diff;
- `MISSING` fail-closed;
- possible duplicates сохраняются;
- `Credit/Cash/Vika` pre-close semantics сохраняются;
- candidate строится/валидируется до current-state mutation;
- failed run физически не меняет verified shadow;
- atomic promotion для обычного delta доказан;
- oversize delta fail-closed/controlled rebuild;
- повторный sync идемпотентен по результату;
- MISSING/AMBIGUOUS имеют resolution contract.

### Критически важно во время перехода

Пока старый workflow после закрытия всё ещё делает `Credit/Cash → Visa` и очищает `Вика`, shadow должен иметь **успешное наблюдение до cleanup**. Если автоматический shadow ещё не работает, перед очередным cleanup должен существовать приватный pre-close snapshot/экспорт. Это временная migration-мера и исчезает после отказа от старого cleanup.

## До первого пользовательского PWA

Reader должен появиться быстро после доказанного YDB shadow. Не допускается месяцами полировать invisible infrastructure.

Минимум:

- auth;
- recent operations;
- provisional `LegacyCurrentPeriodProjection` до R4;
- IndexedDB cache;
- быстрый warm open;
- понятный offline/degraded state.

## До YDB-authoritative writes

Необходимо:

- минимум два доказанных расчётных цикла;
- idempotent write;
- offline outbox;
- optimistic edit/version conflict;
- tested Google compatibility mirror/fallback;
- restore test;
- PeriodClose bootstrap + explicit membership доказаны;
- owner действительно использовал YDB reader;
- unexplained reconciliation mismatch отсутствует.

## Старый репозиторий

Чистый старт **не требует немедленно удалять старый repo**.

Безопасная политика:

1. новый repo создаётся независимо;
2. старый repo не используется как source of architecture/code;
3. после доказанного нового Reader и проверки, что нужные lessons/contracts перенесены, старый repo можно удалить отдельным explicit owner action;
4. удаление старого repo никогда не является условием продолжения нового roadmap.

Это сохраняет clean-room подход без ненужного необратимого риска в первый день.

## Hard stop conditions

Разработка должна остановиться и исправить план, если:

- два canonical документа противоречат друг другу;
- real financial payload оказался в GitHub;
- normalizer не может объяснить source row и пытается угадывать;
- новый framework/process нужен только ради process itself;
- infrastructure work растёт, а следующая видимая capability не приближается;
- performance ухудшается ради архитектурной чистоты;
- переход authority предлагается без доказанного fallback/reconciliation.

## Рекомендуемый первый технический маршрут

```text
New repo
→ minimal CI
→ domain invariants + historical granularity
→ synthetic fixtures
→ expense/income normalizer
→ contextual cleanup + migration diff simulator
→ read-only real-data validation
→ YDB schema/adapter
→ shadow sync
→ minimal Reader PWA
```

Именно этот порядок считается default. Отклоняться от него можно только по фактической зависимости, а не ради более красивой архитектурной схемы.
