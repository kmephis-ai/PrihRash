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
- **LIVE-MUTABLE-SOURCE invariant:** до CUTOVER Google Sheets постоянно меняется и остаётся operational authority; никогда не предполагай freeze/quiet window или append-only discipline. В OPEN legacy working period нормальны manual edits existing rows, изменение даты/amount/category/account/Vika/note, row move/sort, редкое direct row creation и owner cancellation. Initial bootstrap обязан быть привязан к одному immutable source observation/cutoff; обычные source changes после cutoff относятся к incremental catch-up и сами по себе не инвалидируют доказанный cutoff/baseline.
- `row_hint`/ordinal — locator only. Pure reorder exact unique rows не является financial change; reorder ambiguity локализуй только на недоказанном residue. Exact duplicate identity не угадывай.
- Неизвестный/new vocabulary не получает invented alias. Когда unrelated identities доказаны, fail-closed должен быть локальным для затронутой observation/review, а не глобальным только из-за одной новой category; implementation quarantine требует отдельного proof.
- Legacy close — многошаговый owner workflow; snapshot посередине cleanup может быть `CLOSE_IN_PROGRESS`. Background color подтверждён owner как completion signal, но runtime не использует formatting без отдельного provider proof + `SOURCE_ADAPTER_CONTRACT` update.
- `CreditPurchases` и `ActualCreditSettlement` — разные факты: первое входит в expense analytics, второе используется legacy closing balance; их несовпадение само по себе не reconciliation error.
- При fresh Google digest ≠ bootstrap cutoff сначала различай: `BOOTSTRAP_OBSERVATION_INVALID` (сам cutoff недоказуем → fail-closed) и `AUTHORITATIVE_SOURCE_ADVANCED` (cutoff доказан, Google уже новее → baseline не перезапускать только из-за этого; после `COMMITTED` требуется catch-up от последнего COMMITTED observation).
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

Если exact-main `R1 initial bootstrap recovery` доказанно завершился `failure` на
`Deploy recovery-only Function version`, а `Invoke exact read-only recovery tag once` остался
`skipped`, durable outcome Function-version create неизвестен, но YDB recovery invoke не достигнут.
До любого повторного deploy требуется ровно одна read-only provider metadata classification для
этого exact failed recovery run. Successor PR может запросить её только с
`Provider-Attempt: NOT_AUTHORIZED`, `Recovery-Probe: READY`,
`Expected-Transition: READ_ONLY_FUNCTION_DEPLOY_CLASSIFICATION`,
`Recovery-State: DEPLOYMENT_OUTCOME_UNCLASSIFIED` и exact `Recovery-Run-ID` из свежего Issue/run
evidence. Autocontinue dispatch-ит только `r1-initial-bootstrap-recovery-deploy-recovery.yml`;
workflow проверяет exact latest failed run, что deployment step failed и invoke step skipped, затем
только читает Function versions/operations и публикует enum-only artifact. Этот probe не разворачивает
Function, не вызывает Function/YDB и не разрешает следующий deploy/invoke: после классификации нужен
новый causal root-cause decision. Отсутствующее/неоднозначное provider evidence остаётся
`RECOVERY_REQUIRED`; никаких inferred `NOT_APPLIED` или replay.

Standing delegation из §8.3 разрешает автономно выбирать и выполнять последующие stage-appropriate
read-only probes без нового per-probe Owner confirmation. Для того же failed recovery run после
`missing`/`ambiguous` probe каждый successor требует нового exact SHA и новой repository causal
гипотезы/diagnostic discriminator с synthetic regression fixture. Run ID и failed phase остаются
exact-bound; PR использует `Provider-Attempt: NOT_AUTHORIZED`, `Recovery-Probe: READY` и allowlisted
stage-specific transition. Повтор неизменённого query/кода, same-SHA replay или telemetry-only blind
replay запрещены. Любое количество таких read-only refinement cycles не увеличивает write-attempt
circuit и не разрешает deploy/invoke/replay/cleanup/authority changes. Если enum всё ещё missing или
ambiguous, меняй причинную гипотезу и продолжавай только с read-only/repository-only actions.

### 8.2. R1 completion sprint и multi-agent handoff

Пока R1 не имеет доказанного первого `COMMITTED` baseline, operational process определяется
[`docs/R1_COMPLETION_SPRINT.md`](docs/R1_COMPLETION_SPRINT.md). Для R1 этот protocol имеет
приоритет над обычным S-sized дроблением work item, но не над `MIGRATION_CONTRACT`, financial
semantics, privacy/fail-closed или provider authority gates.

ChatGPT/OpenCode не работают одновременно как writers одного R1 conflict domain. Перед первым
write агент обязан проверить latest `R1 SESSION HANDOVER`, active branch/PR/provider run и exact
`main`. Local-only изменения не являются handoff: полезная незавершённая работа должна быть
commit+push либо явно сохранена/отброшена с checkpoint в active tracking Issue.

Единица R1 blocker work — один `Incident-M` causal PR. Не дробить одну причинную гипотезу на
micro-PR ради отдельных enum/telemetry строк. Один merged root-cause change разрешает максимум
один separately gated provider attempt; после него обязателен recovery/read-back и новый handover.

При смене ChatGPT ↔ OpenCode новый агент делает minimal fresh reconciliation, читает exact
`AGENTS.md`, `docs/R1_COMPLETION_SPRINT.md`, applicable R1 runbook и latest handover в динамически
определённом active R1 Issue, после чего продолжает с `Next-Safe-Action`, а не из stale session memory.

### 8.3. Постоянная делегация Owner до завершения R1

Owner делегирует агенту автономно принимать и выполнять все repository/process/provider решения,
необходимые для завершения R1, пока completion target из `docs/R1_COMPLETION_SPRINT.md` не доказан.
Не запрашивать Owner confirmation для каждого следующего causal гипотезы, разрешённого read-only
probe, root-cause PR, gated initial/bootstrap/controlled-rebuild попытки или их обязательного recovery;
после свежей reconciliation выбирать следующий безопасный шаг самостоятельно и отражать решение в
active tracking Issue.

Делегация разрешает использовать уже описанные R1 one-shot write/recovery paths только при их точных
Issue/PR/marker/exact-main/CI/readiness/circuit/provider gates. Она не ослабляет fail-closed, financial
semantics, `MIGRATION_CONTRACT`, LIVE-MUTABLE-SOURCE, privacy, single-writer, no blind/same-SHA replay,
exact failed-run identity/phase checks или обязательный read-back. `COMMITTED` требует независимой
reconciliation; неизвестный/неоднозначный provider outcome не становится `APPLIED`/`NOT_APPLIED` по
догадке. При ambiguous state разрешены только stage-appropriate read-only classification probes и
reproducible repository root-cause work; никакого inferred cleanup/retirement.

Эта делегация не включает CUTOVER, timer activation, YDB-authoritative production Writer, Google
mutation/authority switch, `MEMBER` activation, cap/IAM widening или отмену resource retirement.
Они остаются вне R1 completion target и требуют своих отдельных gates. Все временные R1 permissions,
workflow/autocontinue surfaces и delegated authority retires после доказанного initial
`COMMITTED` + required catch-up/reconciliation completion.

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
