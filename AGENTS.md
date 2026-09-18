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
- R1 shadow/migration writes в YDB разрешены только по `MIGRATION_CONTRACT` и не меняют authority: Google остаётся единственной write authority. YDB-authoritative product/Writer writes (`YDB_WRITE_ENABLED=true`) запрещены до CUTOVER GATE; Writer UX можно доказывать в test/private pilot namespace.
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

### 8.1. Incident-mode exception

Если один и тот же provider gate дважды подряд не достигает ожидаемого перехода либо после
write-capable invoke требуется recovery, разрешён bounded `Incident-M`.

`Incident-M` обязан:

- закрывать одну причинную гипотезу целиком: safe failure signature → reproducible
  adapter/SDK fixture → fix → diagnostic contract → focused tests;
- оставаться в одном PR, хотя внутри PR допустимы несколько логических commits;
- не добавлять больше одной новой authority/schema boundary;
- сохранять full canonical gates, privacy/fail-closed semantics и exact-main guards;
- завершаться явным ожидаемым переходом и stop condition.

Единица работы при incident-mode — **законченная причинная гипотеза**, а не отдельный enum
или отдельная строка workflow. Diagnostic-only изменение не вооружает новый provider invoke.

PR, который должен запустить provider attempt, содержит ровно один machine-readable блок:

```text
Provider-Attempt: READY
Observed-Signature: <ALLOWLISTED_ENUM_PATH>
Expected-Transition: <ALLOWLISTED_ENUM_PATH>
Recovery-State: <EMPTY_DURABLE_STATE|RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE|STAGING_RESUMABLE|STAGING_STALE_RETIREABLE>
Circuit-Rearm: ROOT_CAUSE_FIX
Regression-Test: <tests/...>
```

Автономный provider path не вооружается только по title/Issue number. `Observed-Signature`
обязан точно совпадать с deterministic signature из последнего relevant completed privacy-safe
orchestrator/bootstrap evidence; отсутствующее, неоднозначное или несовпадающее evidence всегда
останавливает autocontinue до provider dispatch. Повтор одного SHA запрещён. В cross-run history
считаются только distinct-SHA root-cause attempts, для которых privacy-safe orchestrator evidence
доказывает реально достигнутый bootstrap invoke. Если одна safe failure signature пережила две
такие root-cause attempts, следующий automatic cycle обязан завершиться точным
`BLOCKED_NEEDS_ROOT_CAUSE` без provider workflow dispatch. Blind diagnostic replay запрещён.

Отдельное stage-specific исключение для **pre-write authoritative source drift** не считается
root-cause attempt. Если последний relevant orchestrator доказанно остановился до readiness/bootstrap
с deterministic signature
`R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED/RECOVERY_REQUIRED/STAGING_RUN_PRESENT`,
а fresh privacy-safe diagnostics доказали
`AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH + STALE_STAGING_CURRENT_STATE_EMPTY`, successor PR на новом
SHA может использовать `Recovery-State: STAGING_STALE_RETIREABLE` и
`Circuit-Rearm: SOURCE_DRIFT_REBASE`. Такой rearm:

- не разрешает same-SHA повтор;
- не увеличивает `prior_root_cause_attempts`;
- обязан обновить canonical `docs/R1_INITIAL_SHADOW_BOOTSTRAP_RUNBOOK.md` с privacy-safe evidence;
- использует canonical regression guard
  `tests/tooling/r1-initial-bootstrap-autocontinue-workflow.test.mjs`;
- разрешает только новый exact-SHA orchestrator с
  `allow_staging_resume=false` и `allow_stale_staging_retirement=true`;
- retires вместе с временным R1 autocontinue/provider surface.

После неуспешного write-capable bootstrap invoke и неуспешной post-invoke recovery
долговечное состояние остаётся неизвестным. Для такого случая successor PR может запросить
только одну read-only recovery на новом exact SHA с
`Provider-Attempt: NOT_AUTHORIZED`, `Recovery-Probe: READY`,
`Expected-Transition: READ_ONLY_DURABLE_CLASSIFICATION` и
`Recovery-State: UNKNOWN_AFTER_NON_SUCCESS`. Этот marker не вооружает provider write;
пока fresh recovery не классифицировала состояние, запрещены replay, cleanup и смена authority.

Если такой surface-only probe вернул только `RECOVERY_REQUIRED / STAGING_RUN_PRESENT`, это ещё не
`STAGING_RESUMABLE` и не `STAGING_STALE_RETIREABLE`. Successor PR на новом SHA может запросить
ровно одну full read-only recovery с
`Provider-Attempt: NOT_AUTHORIZED`, `Recovery-Probe: READY`,
`Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION` и
`Recovery-State: STAGING_PRESENT_UNCLASSIFIED`. Этот marker не вооружает readiness/orchestrator/
bootstrap и не разрешает cleanup; он существует только для fresh Google-aware + exact revision
diagnostics после surface-only durable classification.


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

## 15. Direct Git transport fallback

Перед local development один раз проверь direct Git transport к canonical GitHub remote.

Если `git ls-remote` / `git clone` не работает из-за DNS/HTTPS egress, это **не** означает, что local Git unavailable. Обязательный следующий шаг — `tools/local-git-mirror` по его repository-local contract.

После materialization обязательно доказать:

- `HEAD == exact current provider SHA`;
- `git fsck --full --no-dangling` PASS;
- initial working tree clean.

Дальше normal cycle остаётся локальным: branch/worktree → implement → доступный `npm run check` → commit. Если direct `git push` также заблокирован, публикуй проверенный local result через authorized GitHub connector/API transport и затем проверяй provider-side exact-head CI.

GitHub API-only development допустим только если отдельно доказано, что не сработали **и** direct Git transport, **и** `tools/local-git-mirror`. Нельзя писать `local Git unavailable` только на основании failed `git clone` / `git ls-remote`; фиксируй отдельно `direct Git transport unavailable` и конкретную ошибку mirror/materialization path.
