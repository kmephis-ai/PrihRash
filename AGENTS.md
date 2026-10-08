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

Если fresh full read-only recovery уже доказала
`INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED / RECOVERY_REQUIRED / STAGING_RUN_PRESENT`, но для нового
exact-main SHA ещё нет обязательной pre-write orchestrator signature, допускается один stage-specific
repository-native preflight без write authority. Successor process-only PR использует только:

```text
Provider-Attempt: NOT_AUTHORIZED
Orchestrator-Preflight: READY
Observed-Recovery: INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED/RECOVERY_REQUIRED/STAGING_RUN_PRESENT
Expected-Transition: R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED/RECOVERY_REQUIRED/STAGING_RUN_PRESENT
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Recovery-Run-ID: <exact successful full recovery run>
Regression-Test: tests/tooling/r1-initial-bootstrap-autocontinue-workflow.test.mjs
```

Autocontinue обязан доказать exact successful recovery run, его read-only invoke phase, enum-only
classification artifact, ancestry к source SHA и process-only changeset. Затем он dispatch-ит только
orchestrator с `allow_staging_resume=false` и `allow_stale_staging_retirement=false`; root-cause
history circuit для этого preflight не увеличивается. Такой run не разрешает readiness/bootstrap,
retirement, resume или cleanup: ожидается stop на initial read-only recovery. Только его exact
`R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED/RECOVERY_REQUIRED/STAGING_RUN_PRESENT` evidence может
позже служить входом отдельного `SOURCE_DRIFT_REBASE`. Missing/ambiguous/mismatched evidence всегда
STOP до dispatch.

Для autocontinue-triggered R1 provider/orchestrator workflow exact successful canonical CI identity
нужно передавать как run ID из исходного `workflow_run`, если downstream restore/gate поддерживает
такой input. Downstream обязан read-only получить именно этот run и проверить его через canonical
`scripts/classify-github-ci-run.mjs` против exact SHA; повторный list-query по CI history не должен
подменять уже известную identity и создавать artificial ambiguity/eventual-consistency blocker.
List-based discovery допускается только как fail-closed fallback для manual path без explicit CI run ID.
Artifact по-прежнему обязан пройти exact source SHA/package digest verification. Если такой handoff
исправляет preflight, остановившийся до provider access на `R1_EXACT_SOURCE_CI_NOT_UNIQUE`, тот же
`Orchestrator-Preflight: READY` successor может включать только exact handoff surface:
restore action, orchestrator input plumbing, их targeted tests и уже обязательные preflight
workflow/test + AGENTS/runbook; любой другой файл fail-closed до dispatch.

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

Если exact-main `R1 initial bootstrap recovery` завершился `failure` на
`Verify exact accepted recovery Function version for reuse`, а deploy и invoke остались `skipped`, это
доказывает pre-invoke stop, но не доказывает применимость exact Function version или Audit-source.
Допускается ровно одна новая full read-only classification с
`Provider-Attempt: NOT_AUTHORIZED`, `Recovery-Probe: READY`,
`Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION`,
`Recovery-State: STAGING_PRESENT_UNCLASSIFIED`, точными `Recovery-Run-ID` и
`Recovery-Version-Run-ID` из свежего evidence и regression guard
`tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs`. Workflow проверяет exact
failed phase/source/version history, не добавляет IAM bindings и публикует enum-only recovery evidence
даже если version proof снова завершится до Audit-source read. `EXISTING_APPLICABLE_AUDIT_SOURCE`
разрешает только уже-gated read-only recovery; `NO_APPLICABLE_PREEXISTING_AUDIT_SOURCE` завершает
Audit-source ветку и требует смены causal model; `SOURCE_EVIDENCE_UNUSABLE/AMBIGUOUS` остаётся STOP.
Не повторять workflow с теми же SHA/run IDs; никакого infer cleanup, IAM mutation, create или replay.

Если ordinary `R1 initial bootstrap recovery` **или dedicated Owner-authorized recovery deploy-only attempt**
падает непосредственно на `CreateVersion`, raw provider stderr остаётся runner-local. Failure branch обязан
до завершения сделать ровно один read-only Function-scoped `ListOperations` read-back в bounded create
window и опубликовать только allowlisted `failureClass`, `permissionBoundary`, `cliExit`,
`createOperationEvidence` и `failureBoundary`.
`CREATE_OPERATION_NOT_OBSERVED` + nonzero CLI exit локализует failure как
`PRE_OPERATION_OR_SYNC_REJECTION`, но **не** доказывает `NOT_APPLIED`; observed/in-progress/completed
operation означает `ASYNC_OPERATION_OBSERVED` и запрещает replay до отдельной classification.
Unreadable/paginated/malformed/ambiguous operation evidence остаётся `UNCLASSIFIED`. Raw stderr,
operation/version IDs и provider response не публикуются.

Owner 2026-10-07 отдельно разрешил ровно один dedicated recovery-only `CreateVersion` для failed
recovery run `37238416504`. Текущий machine marker: `Provider-Attempt: READY`,
`Observed-Signature: INITIAL_BOOTSTRAP_RECOVERY_DEPLOY_FAILED`,
`Expected-Transition: RECOVERY_ONLY_FUNCTION_VERSION_CREATE_CLASSIFIED`,
`Recovery-State: DEPLOYMENT_OUTCOME_UNCLASSIFIED`,
`Circuit-Rearm: OWNER_AUTHORIZED_SINGLE_RECOVERY_DEPLOY`,
`Recovery-Run-ID: 37238416504`,
`Regression-Test: tests/tooling/initial-bootstrap-recovery-deploy-attempt-workflow.test.mjs`.
Разрешение не включает Function invoke, IAM/YDB/Google mutation, cleanup, timer/cutover и не переиспользует
историческую authority для `36341844854`. После входа в create step это разрешение consumed независимо
от результата; повторный create/replay запрещён.

Первый exact-main successor `37680553048` остановился **до** provider create на
`RECOVERY_DEPLOY_ATTEMPT_FUNCTION_READ_FAILED`: provider-preflight step = `failure`,
reassert-before-create = `skipped`, create step = `skipped`. Поэтому authority не consumed, но same-SHA
replay запрещён. Допустим только distinct-SHA correction stale provider-read implementation: dedicated
deploy-attempt обязан использовать уже канонические REST `Function.List`, `ListAccessBindings` и
`Trigger.List` boundaries с существующими enum-only classifiers; Function invoke/IAM/YDB/Google scope
не расширяется.

PR #921 merged как `ed73939096b8450dbddb4067897c16f89725176f`; distinct-SHA attempt `37727175095`
дошёл до create step и тем самым consumed authority. Enum-only result:
`NOT_FOUND / CREATE_OPERATION_NOT_OBSERVED / PRE_OPERATION_OR_SYNC_REJECTION`; exact Function
`ListOperations` в attempt window также содержит 0 operations. Exact-source package, Function,
runtime SA и Lockbox version/key references доказаны существующими/ACTIVE, поэтому конкретный
provider-side `NOT_FOUND` resource из сохранённого evidence не локализован; replay старого `yc`
attempt запрещён.

Owner 2026-10-08 отдельно разрешил ровно **один дополнительный** recovery-only `CreateVersion` с
изменением client/mechanism. Durable authority: Issue #630 comment `6056859760`. Выбран direct REST
`POST /functions/v1/versions` с exact verified recovery ZIP как inline `content`, explicit
Function/runtime-SA/Lockbox references и отдельным one-shot workflow. Machine marker:
`Provider-Attempt: READY`,
`Observed-Signature: RECOVERY_FUNCTION_VERSION_CREATE_FAILED/NOT_FOUND/CREATE_OPERATION_NOT_OBSERVED/PRE_OPERATION_OR_SYNC_REJECTION`,
`Expected-Transition: RECOVERY_ONLY_FUNCTION_VERSION_CREATE_REST_CLASSIFIED`,
`Recovery-State: DEPLOYMENT_OUTCOME_UNCLASSIFIED`,
`Circuit-Rearm: OWNER_AUTHORIZED_DIRECT_REST_RECOVERY_DEPLOY`,
`Recovery-Run-ID: 37238416504`,
`Recovery-Consumed-Run-ID: 37727175095`,
`Authority-Comment-ID: 6056859760`.
Direct workflow обязан доказать exact merged marker PR/CI, active tracking Issue, оба prior phases,
private trigger-free/provider references и историю previous direct-REST attempts. Distinct-SHA predecessor
допустим только если его direct-REST create step доказанно `skipped`; same-SHA predecessor или любой
non-skipped/ambiguous create step запрещает continuation. POST выполняется ровно один раз; returned
Operation и Function `ListOperations` читаются только read-only. Function
invoke, IAM/YDB/Google mutation, cleanup, timer/cutover не разрешены. Достижение REST POST consumes
authority независимо от outcome; второй POST/replay запрещён.

Если свежая read-only классификация для того же failed reuse-verification run доказала
`NO_APPLICABLE_PREEXISTING_AUDIT_SOURCE`, Audit-source ветка терминальна. Допускается сменить causal
model на независимый exact version proof по typed metadata уже существующей Yandex
`CreateFunctionVersion` operation: API contract задаёт metadata type
`yandex.cloud.serverless.functions.v1.CreateFunctionVersionMetadata` с `function_version_id`, а её
значение обязано совпасть с ровно одной version в exact time window, активным recovery tag и полной
runtime/entrypoint/runtime-service-account конфигурацией. `Operation.response` ID, если присутствует,
обязан совпасть; malformed, missing, conflicting или ambiguous metadata остаётся STOP. Только exact
совпадение разрешает единственный уже-gated write-free recovery invoke без Audit Trails или IAM reads;
иначе deploy/invoke остаются skipped и recovery state UNKNOWN. Marker остаётся
`Provider-Attempt: NOT_AUTHORIZED`, `Recovery-Probe: READY`,
`Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION`, `Recovery-State: STAGING_PRESENT_UNCLASSIFIED`
с exact target, accepted-version source и failed-classification run IDs. Это иной proof source, а не
новый enum/read-shape refinement; для наблюдённого `CREATED_VERSION_NOT_PROVEN` failed classifier
останавливается до Audit Trails/IAM fallback, synthetic fixtures и все terminal cases входят в тот же
causal PR.

Если exact metadata proof не доказан, не повторять `ListOperations` response-shape probes. Допускается один
materially different read-only resource path: выбрать единственный completed/error-free actor/time-bound
operation ID из уже прочитанного exact Function-scoped списка и запросить этот ID через Yandex
`OperationService.Get`. ID хранить только runner-local; Get resource ID, typed metadata ID, optional
response Version ID, unique active version/tag и full runtime contract обязаны совпасть. Любой missing,
ambiguous, denied, malformed или conflicting результат завершает flow без Audit/IAM fallback и Function
invoke; exact совпадение разрешает ровно один существующий write-free durable recovery invoke. Этот bypass
— новая causal модель/provenance resource, а не discriminator refinement; все response/phase outcomes
покрыть synthetic fixtures и одним marker-bound Incident-M.

Если и `OperationService.Get` не даёт exact version proof, больше не уточнять Operation response shape.
Следующий materially different root model использует provider-independent source fact из GitHub Actions:
accepted `Recovery-Version-Run-ID` уже обязан быть доказанным единственным create-only source, а внутри
него ровно один step `Create exactly one read-only recovery Function version without invoking it` обязан
завершиться `success`. Только timestamps этого exact step задают source window. Provider read-only path
затем сверяет `version list`, полный immutable `GetVersionByTag` recovery config и `ListTagHistory`:
один и тот же current `functionVersionId`, recovery tag, created/effectiveFrom внутри step window,
а tag-history interval обязан быть активен в момент provider read: workflow фиксирует `observedAt`
после чтения history и требует `effectiveFrom <= observedAt < effectiveTo`; более позднего assignment
быть не должно. Не трактовать наличие `effectiveTo` как завершённый tag само по себе: Yandex REST
возвращает future end timestamp и для текущего mapping. Runtime/entrypoint/runtime service account,
memory/timeout, recovery env, no-logging, metadata options и Lockbox secret mappings обязаны совпасть
с create-only contract.

Этот source-step/tag-history proof не читает Operation list/Get и не использует Audit Trails. Exact
совпадение разрешает только уже-gated существующий write-free recovery invoke; любое расхождение остаётся
fail-closed до invoke. Запрещены новая Function version, redeploy, IAM mutation, YDB/Google write, cleanup,
same-SHA replay или inference по близкому времени без exact successful source-step evidence. Изменение
делать одним Incident-M вместе с classifier/workflow fixtures, autocontinue regression test и canonical
docs.

Для этого stage-specific reuse marker три run identity различны и обязательны: `Recovery-Run-ID` —
оригинальный failed recovery target, `Recovery-Version-Run-ID` — успешный create-only source именно для
этого target, а `Recovery-Classification-Run-ID` — exact latest source-relative failed reuse-verification
predecessor с deploy/invoke `skipped`. Для текущего permission-attempt marker это соответственно
`36341844854`, `36611387299`, `36709073723`. Autocontinue и canonical recovery обязаны обе проверить последнее
сопоставление; target guard допускает, что historical workflow ещё не имел reuse-verification step
(или имел ровно один `skipped`), но не принимает duplicate/failed verification; classification run
сам обязан иметь точный failed-verification/deploy-skipped/invoke-skipped phase. Не переиспользовать
classification run как target recovery ID.

Standing delegation из §8.3 разрешает автономно выбирать и выполнять последующие stage-appropriate
read-only probes без нового per-probe Owner confirmation. Для того же failed recovery run после
`missing`/`ambiguous` probe каждый successor требует нового exact SHA и новой repository causal
гипотезы/diagnostic discriminator с synthetic regression fixture. Run ID и failed phase остаются
exact-bound; PR использует `Provider-Attempt: NOT_AUTHORIZED`, `Recovery-Probe: READY` и allowlisted
stage-specific transition. Повтор неизменённого query/кода, same-SHA replay или telemetry-only blind
replay запрещены. Любое количество таких read-only refinement cycles не увеличивает write-attempt
circuit и не разрешает deploy/invoke/replay/cleanup/authority changes. Если enum всё ещё missing или
ambiguous, меняй причинную гипотезу и продолжавай только с read-only/repository-only actions.

#### One-shot recovery-only Function deploy decision (Owner 2026-09-29)

Для exact failed recovery run `36341844854` Owner отдельно разрешил **ровно одну** новую
`recovery-only Function version create` попытку после завершённого read-only deploy classification.
Scope не включает Function invoke, Google/YDB read/write, IAM mutation, replay bootstrap, cleanup,
timer/cutover или authority switch. Это не переопределяет неизвестный create outcome как `NOT_APPLIED`;
повтор допустим только как отдельный Owner-authorized deploy-only transition на новом exact main SHA,
после canonical CI, exact failed-run/deploy-failed/invoke-skipped, PR marker и single-writer gates.

PR marker:

```text
Provider-Attempt: READY
Observed-Signature: INITIAL_BOOTSTRAP_RECOVERY_DEPLOY_FAILED
Expected-Transition: RECOVERY_ONLY_FUNCTION_VERSION_CREATE_CLASSIFIED
Recovery-State: DEPLOYMENT_OUTCOME_UNCLASSIFIED
Circuit-Rearm: OWNER_AUTHORIZED_SINGLE_RECOVERY_DEPLOY
Recovery-Run-ID: 36341844854
Regression-Test: tests/tooling/initial-bootstrap-recovery-deploy-attempt-workflow.test.mjs
```

Workflow `.github/workflows/r1-initial-bootstrap-recovery-deploy-attempt.yml` создает только одну
immutable recovery Function version, не вызывает её, не трогает YDB/Google, захватывает provider stderr
лишь в runner-temporary file и публикует allowlisted error class/resource boundary enums. Raw stderr,
IDs и secret values не публикуются. Возможный `RECOVERY_FUNCTION_VERSION_CREATE_ACCEPTED_NO_INVOKE`,
known error class или unresolved error — терминальный outcome этого authorization: workflow проверяет
cross-SHA history по exact failed run и не dispatch-ится повторно, если create step уже был достигнут.
Синтетически доказанный pre-provider stop, где create step `skipped`, не расходует одноразовый create
allowance; continuation допускается только на новом exact SHA после исправления самого preflight gate.
PR #870 был exact таким случаем: issue-state casing блокировал deploy до provider; issue #453 проверка
должна использовать REST `state == open`. Следующий attempt-history classifier требует предыдущий exact
run/job/step и не выводит `skipped` по одному run conclusion. Если было несколько distinct-SHA preflight
stops, continuation допускается только когда exact run/job/deploy-step evidence доказывает `skipped`
для **каждого** предыдущего attempt; reached create, same SHA, missing/duplicate/ambiguous evidence
всегда блокируют continuation. Все такие preflight stops остаются нерасходующими create allowance, но
не позволяют replay одного SHA. Self-SHA guard обязан исключать только текущий workflow run по
`GITHUB_RUN_ID`, продолжая проверять все прочие run на этот SHA.
Следующий Function invoke/IAM change требует собственной applicable authority; ни один deploy result
сам по себе не доказывает YDB durable state или `COMMITTED`. Этот bounded Owner exception не отменяет
правило, что обычный diagnostic-only PR не вооружает provider attempt.

После `RECOVERY_FUNCTION_VERSION_CREATE_ACCEPTED_NO_INVOKE` one-shot create закрыт. Отдельная
stage-appropriate read-only durable recovery может reuse-ить только уже созданную версию, если новый
exact-main read-only marker, успешный exact deploy-run, все prior deploy-step evidence и свежая Yandex
tag/version metadata доказывают unique active private recovery version. Если operation metadata даёт только
tagged-version candidate, corroboration допускается только через уже-контрактный Audit Trails → Cloud
Logging `CreateFunctionVersion` source: exact actor/function/time/version обязан совпасть с единственной
active recovery tag/version и runtime contract. Reuse path обязан пропустить
Function-version create и вызвать только write-free recovery handler ровно один раз; если provenance,
tag, metadata или exact-main gate не доказаны — STOP без invoke/redeploy. Результат recovery ведёт к
state-specific решению; неизвестный outcome не разрешает replay, а `COMMITTED` требует независимой
canonical reconciliation.
Read-only reuse marker обязан однозначно связать failed recovery run и successful version-create
run ID; autocontinue передаёт оба точных ID только в canonical recovery workflow. Workflow повторно
проверяет обе истории, source PR/marker и active tag metadata до invocation. Этот marker не вооружает
новый create или write-capable bootstrap invoke. Failed/missing/ambiguous preinvoke metadata публикуется
только как allowlisted enum artifact; raw audit/version payload остаётся runner-local.
Для GitHub Actions runs endpoint `.name` может быть custom `run-name`/`display_title`, а не static
workflow filename name. Identity recovery deploy-only workflow берётся из exact
`/actions/workflows/<file>.yml/runs` endpoint и `workflow_id`; не фильтруй его по static `.name`.
Единственный reuse marker дополнительно использует `Recovery-Version-Run-ID`; его allowed shape и
synthetic terminal cases проверяются в одном Incident-M вместе с caller/recovery workflows. Exact
version proof → одна read-only durable classification; missing/ambiguous metadata → STOP без invoke;
read-only recovery verdict → разные state-specific bootstrap, reconciliation/catch-up или root-cause
решения. Diagnostic enum не создаёт отдельную PR-цепочку.

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

Owner anti-S-unit override: operational unit — законченный Incident-M causal boundary, а не
default S-sized item. Новый enum, response-shape discriminator, pagination detail, telemetry field
или preflight/CI race внутри того же provider/read path не является новой causal hypothesis и не
оправдывает отдельный PR. Перед PR определить конечные outcomes и различный инженерный next step
для каждого; если все outcomes требуют только новой диагностики — PR не создавать. После первого
diagnostic refinement successor обязан объединить предвидимые cases, synthetic fixtures и привести
boundary к одному decision point. После двух distinct-SHA read-only refinements без decision point
третий discriminator-only PR запрещён: сменить root-cause model/solution, найти безопасный bypass или
остановиться `BLOCKED_NEEDS_ROOT_CAUSE`.

Successor после pre-provider CI/autocontinue changeset stop остаётся тем же Incident-M boundary:
включать полную допустимую causal changeset, тестируемые caller/recovery predicates и terminal outcomes;
повтор `enum -> PR -> probe -> более точный enum -> PR` запрещён.

Если exact-main recovery autocontinue возвращает `R1_RECOVERY_AUTOCONTINUE_REUSE_CHANGESET_INVALID`,
это pre-provider stop: recovery workflow не dispatch-ился, provider gate не достигнут, read-only
classification не потреблена. Successor на новом exact SHA сохраняет неизменённый marker и exact
`Recovery-Run-ID`/`Recovery-Version-Run-ID`/`Recovery-Classification-Run-ID`, включает указанную в marker
`Regression-Test` вместе с canonical recovery workflow/test, autocontinue caller test, runbook и этими
process docs; затем проходит существующие exact failed-phase/source-history guards. Не менять IDs,
не повторять SHA и не считать autocontinue `success` доказательством recovery dispatch.

Bounded recovery history использует exact failed-run GET и server-side `created` window к latest
recovery predecessor: autocontinue берёт только latest, работающий recovery workflow — current run
плюс latest predecessor. Source-only history либо один exact distinct-SHA failed verification stop с
deploy/invoke `skipped` разрешают оставшиеся exact gates; иной/missing/ambiguous latest predecessor
блокирует dispatch. Не возвращаться к полной-history pagination: неразрешённый bounded result требует
пересмотра causal model, а не page-size/telemetry-only PR.

Для Audit Trails boundary после #867 (`AUDIT_TRAIL_TRAILS_FIELD_INVALID`, `TrailService.List`
достигнут) запрещён отдельный PR только для `omitted trails => []`. Один causal PR обязан завершить
ветку исходом `EXISTING_APPLICABLE_AUDIT_SOURCE`, `NO_APPLICABLE_PREEXISTING_AUDIT_SOURCE` либо
`SOURCE_EVIDENCE_UNUSABLE/AMBIGUOUS`, затем использовать доказанный источник или прекратить ветку
и сменить causal model. Синхронизировать это правило с `docs/R1_COMPLETION_SPRINT.md` в том же PR;
отдельный process/docs PR запрещён.

Если Cloud-wide `ListFolders` не возвращает точный `YC_FOLDER_ID`, который уже прошёл Function и
Lockbox metadata gates, не продолжать enum/refinement ветки инвентаризации. Законченный причинный
successor может обойти её прямым folder-scoped Audit Trails `List` только для этого точного ID;
обязан проверить `folderId`/`cloudId`, ProtoJSON empty repeated-field и pagination, затем принять
терминальное source decision. Это не разрешает alias inference или replay.

Если direct exact-folder list возвращает `AUDIT_TRAIL_LIST_PERMISSION_DENIED`, следующий causal
successor может запросить ровно одну temporary `audit-trails.viewer` binding на exact folder и,
только после доказанного единственного Cloud Logging destination, `logging.reader` на exact group.
Обязательно доказать отсутствие каждого binding перед add и точный read-back после add, удалить только
binding, созданный этим run, и независимо подтвердить retirement. Pre-existing binding не удаляется;
malformed/duplicate/read-back/retirement evidence всегда STOP. Это Provider-Attempt READY
temporary-authority path, не `NOT_AUTHORIZED`; он не разрешает Function create, необусловленный YDB
invoke или replay.

Exact permission-denial marker обязан совпасть с последним enum-only artifact и связывать exact
failed recovery/version-source run IDs; scope ограничен Function folder и единственной доказанной
Cloud Logging group, без parent-cloud или более широкого role binding.

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

### 8.4. Owner-approved async invocation contract для R1

После двух consumed root-cause attempts с одинаковой внешней подписью
`FAIL/INITIAL_BOOTSTRAP_INVOKE_FAILED` synchronous circuit остаётся
`BLOCKED_NEEDS_ROOT_CAUSE`; третий sync bootstrap/replay запрещён.

Owner 2026-10-01 отдельно разрешил bounded R1 item для Yandex Cloud Functions asynchronous
invocation contract. Это новая provider-delivery model, а не rearm старого circuit. До отдельного
exact-main provider marker contract work остаётся repository/test-only.

Обязательные границы async path:

- Yandex async feature считать Preview и использовать только внутри временной R1 bootstrap surface;
- `async-max-retries=0`; provider retries запрещены;
- success/failure YMQ targets не создавать и не настраивать;
- новые paid resources запрещены;
- не добавлять IAM binding ради async path: async executor — exact runtime service account
  `prihrash-initial-bootstrap`, который уже имеет exact-Function `functions.functionInvoker` и который
  deployment WIF уже имеет право использовать через существующий `iam.serviceAccounts.user`;
  deployment WIF остаётся deploy/admission caller и не должен назначаться async executor без отдельно
  доказанного self-use permission; обе invocation bindings проверять read-back, иначе STOP;
- async version должна иметь отдельный tag `r1-initial-bootstrap-async`;
- HTTPS `integration=async` должен принимать только `HTTP 202`; это означает только
  `INITIAL_BOOTSTRAP_ASYNC_ACCEPTED`, не `COMMITTED`;
- тело async HTTP response игнорировать и не публиковать;
- после `202` не делать повторный invoke;
- durable outcome классифицировать только существующим read-only recovery после полного
  Function execution window; до recovery никакого inferred success/failure;
- `COMMITTED` по-прежнему требует independent reconciliation/catch-up;
- Google остаётся authoritative.

Любая будущая provider-capable интеграция async path требует отдельного exact-main PR marker,
canonical CI, fresh recovery/stale-retirement gates, fresh readiness, single-writer и one-shot
async admission. Старый sync root-cause attempt counter не сбрасывать и не обходить.

После safe signature `INITIAL_BOOTSTRAP_ASYNC_DEPLOY_FAILED` у первого bounded attempt, новый-SHA
read-only classifier должен связывать точный failed step с единственным function-scoped
`CreateFunctionVersion` operation, typed version ID,
version list, active `r1-initial-bootstrap-async` tag-history interval и полным zero-retry/no-target/
runtime/Lockbox contract. Отсутствие версии в list/tag без operation provenance не является
`NOT_APPLIED` и не разрешает повтор create.

Терминальные действия различаются: `INVOCATION_ONLY_READY / VERSION_PROVEN` разрешает только отдельный
exact-main invocation-only marker после fresh recovery/readiness, без deploy; exact
`REQUEST_CONTRACT_INVALID` ведёт к repository request-contract fix; `CREATE_PERMISSION_DENIED` ведёт к
STOP без IAM widening; ambiguous/missing/in-progress/config-conflicting evidence остаётся UNKNOWN и
STOP. Classifier не читает Google/YDB, не меняет IAM, не создаёт Function version и не вызывает Function.
Все cases, fixtures и anti-S-unit sync с completion sprint/runbook входят в один Incident-M.

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
