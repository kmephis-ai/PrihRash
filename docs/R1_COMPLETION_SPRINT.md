# R1 Completion Sprint

## Статус

Этот документ — normative operational overlay для активного R1 до доказанного первого
`COMMITTED` shadow baseline и обязательного catch-up, если Google успел продвинуться.
Он не меняет `MIGRATION_CONTRACT`, financial semantics или authority model:
до CUTOVER `Google authoritative -> YDB shadow`.

Цель режима — закончить R1 быстрее без потери fail-closed, privacy и recovery guarantees.
Он заменяет для активного R1 цепочки micro-PR на bounded completion sprint.

## Source of truth

Порядок восстановления состояния:
1. exact current `main` и canonical docs;
2. actual GitHub/provider/runtime state;
3. active R1 tracking Issue и последний `R1 SESSION HANDOVER`;
4. локальный контекст агента — только как подсказка.

Старый чат, OpenCode session, локальный stash или handover не переопределяют GitHub/provider state.
## Single writer и передача между агентами

Для R1 одновременно допускается только один write-capable agent: ChatGPT, OpenCode или другой.
Перед первым repository/provider write агент обязан проверить exact `main`, active Issue/PR,
последний provider run и отсутствие другого активного R1 writer branch/PR/run.

Если другой writer активен, новый агент работает только read-only и не push/merge/dispatch.

Передача между агентами не может зависеть от невидимых local-only изменений.
Полезная незавершённая работа должна быть либо commit+push в явно указанную ветку,
либо явно сохранена/отброшена с записью в handover. GitHub остаётся canonical history.

Номер tracking Issue не хардкодить в runtime/process logic: определять его из current GitHub state.
Текущий issue может быть указан в handover только как snapshot текущего состояния.

## Единица работы

Default unit для активного blocker R1 — `Incident-M`: одна законченная причинная гипотеза.
Внутри одного Incident-M допустимы несколько связанных code/test/doc changes, но один PR.

Цикл:
`safe failure signature -> root-cause hypothesis -> reproducible fixture -> fix -> tests -> canonical check -> PR/CI`.

Diagnostic-only изменение само по себе не вооружает новый provider attempt.
Не создавать отдельный PR ради одного enum, одной строки telemetry или одного coarse bucket,
если они относятся к той же причинной гипотезе.
Если одинаковая safe failure signature пережила две distinct-SHA root-cause attempts,
следующий цикл обязан сменить причинную гипотезу/решение либо остановиться
`BLOCKED_NEEDS_ROOT_CAUSE`. Дополнительный blind diagnostic replay запрещён.

### Owner anti-S-unit override

Operational unit активного R1 — законченный `Incident-M` causal boundary, не default S-sized item.
Новый enum, response-shape discriminator, pagination detail, telemetry field или preflight/CI race
в том же provider/read path не является новой causal hypothesis и не оправдывает отдельный PR.
Перед PR определить конечные outcomes и различный инженерный next step для каждого; если все исходы
ведут только к дополнительной диагностике — PR не создавать. После первого diagnostic refinement
successor объединяет все разумно предвидимые cases, synthetic fixtures и доводит boundary до одного
decision point. После двух distinct-SHA read-only refinements без decision point третий
discriminator-only PR запрещён: сменить root-cause model/solution, найти безопасный architectural/
process bypass либо остановиться `BLOCKED_NEEDS_ROOT_CAUSE`.

Pre-provider CI/autocontinue changeset stop не начинает новую causal hypothesis: его successor
остаётся тем же Incident-M и включает полную допустимую causal changeset, fixture-tested
caller/recovery predicates и terminal outcomes. Последовательность `enum -> PR -> probe -> более точный enum -> PR`
запрещена.

Recovery-history root model использует exact failed-run GET и server-side `created` window к latest
predecessor вместо полной истории: autocontinue берёт latest, текущий recovery workflow проверяет себя
и latest prior. Source-only и один exact distinct-SHA failed verification stop с deploy/invoke `skipped`
могут перейти к оставшимся gates; missing, ambiguous, active или иной latest predecessor остаётся
terminal pre-provider block. Не дробить это на pagination/enum refinements; если bounded decision не
подтверждён, пересмотреть causal model.

Для Audit Trails boundary после #867 (`AUDIT_TRAIL_TRAILS_FIELD_INVALID`, `TrailService.List`
достигнут) запрещён отдельный PR только ради `omitted trails => []`. Один causal PR должен довести
источник до `EXISTING_APPLICABLE_AUDIT_SOURCE`, `NO_APPLICABLE_PREEXISTING_AUDIT_SOURCE` либо
`SOURCE_EVIDENCE_UNUSABLE/AMBIGUOUS`, затем использовать доказанный источник или прекратить эту
ветку и сменить causal model. Правило синхронизируется в `AGENTS.md` в том же causal PR; отдельный
process/docs PR запрещён.

Если Cloud-wide `ListFolders` не содержит уже точно проверенный `YC_FOLDER_ID`, root-cause successor
может напрямую прочитать Audit Trails в этой папке, минуя вспомогательную инвентаризацию. Он должен
синхронно классифицировать точные folder/cloud identity, пустой ProtoJSON `trails`, malformed и
pagination cases до одного source decision point; неизвестный результат остаётся unusable/ambiguous.
Этот bypass не меняет authority и сам по себе не разрешает Function/YDB invoke.

Если direct exact-folder `List` возвращает `AUDIT_TRAIL_LIST_PERMISSION_DENIED`, distinct causal blocker
— отсутствующее read authority. Один Incident-M может временно добавить `audit-trails.viewer` только
на эту папку и, лишь после доказанного единственного Cloud Logging destination, `logging.reader` на
точную группу. Обязательно доказать отсутствие каждого binding перед add и точный read-back после add,
удалить только binding, созданный этим run, и независимо подтвердить retirement. Pre-existing binding
не удаляется; malformed/duplicate/read-back/retirement evidence всегда STOP. Missing/ambiguous IAM
evidence останавливает дальнейшие source probes; marker является write-capable temporary-authority
attempt и не разрешает Function create или replay.
Marker обязан exact-bind-ить свежий `AUDIT_TRAIL_LIST_PERMISSION_DENIED/SOURCE_EVIDENCE_UNUSABLE`, failed
recovery run `36341844854`, accepted deploy-only run `36611387299` и точный authority-scope из canonical
runbook. Это одна bounded causal attempt: если binding/read/event outcome или retirement не доказан,
YDB recovery invoke remains skipped and durable state remains UNKNOWN; same-SHA retry запрещён.

Exact permission-denial marker обязан совпасть с последним enum-only artifact и связывать exact
failed recovery/version-source run IDs; scope ограничен Function folder и единственной доказанной
Cloud Logging group, без parent-cloud или более широкого role binding.

Если temporary-permission source PR останавливается раньше IAM path: exact recovery reuse verification
failed, deploy/invoke `skipped`, допустим только следующий stage-specific full read-only classification
точных failed `Recovery-Run-ID` + accepted `Recovery-Version-Run-ID`. Он не повторяет permission attempt
и не добавляет binding. В одном successor Incident-M source/current/intervening run phases проходят
fixture-tested exact guards; cleanup/artifact trap обязан переживать version-proof exits. Результаты
ведут к разным terminal actions: applicable source → только существующий read-only recovery; no source →
прекратить Audit-source path и сменить causal model; unusable/ambiguous → STOP; version still unproven →
отдельная причинная гипотеза provenance, без повторения этого probe/SHA.

После terminal `NO_APPLICABLE_PREEXISTING_AUDIT_SOURCE` допускается один root-model change к typed
`CreateFunctionVersion` operation metadata, независимый от Audit Trails. API `CreateVersion` определяет
`CreateFunctionVersionMetadata.function_version_id`; metadata ID принимается только при exact operation
actor/time, успешном завершённом operation, unique version-list match внутри source run window, exact
active recovery tag version и полной runtime/entrypoint/service-account конфигурации. Любой response ID
должен совпасть; missing/malformed/conflicting/ambiguous metadata завершает recovery без invoke/redeploy.
Exact proof разрешает лишь уже-gated один write-free recovery invoke, который классифицирует durable state;
он не доказывает `COMMITTED`. PR обязан включить полный набор synthetic fixtures, exact run/phase guards,
artifact preservation и обновить `AGENTS.md` и runbook в том же Incident-M. Терминальные результаты
различны: exact proof → read-only durable classification; proof absent/invalid → stop UNKNOWN без
Function/YDB invoke. Для наблюдённого `CREATED_VERSION_NOT_PROVEN` pre-invoke stop не повторяет Audit
Trails/IAM/deploy paths.

Если typed metadata по существующей Function `ListOperations` projection остаётся unproven, следующий
causal model меняет источник: `OperationService.Get` для единственного ID, локально выбранного из точного
Function-scoped actor/time list operation. Этот independent resource read обязан подтвердить Get ID,
typed CreateFunctionVersion metadata, optional Version response ID и unique active version/tag/config.
Иначе fail-closed stop без Audit/IAM/deploy/invoke; exact match → только один existing write-free durable
classification. Один Incident-M включает REST adapter, all response/oneof/phase fixtures, privacy guard,
caller/recovery changeset gates и docs; это не разрешение на третью response-shape discriminator PR.

Если exact `OperationService.Get` path остаётся `CREATED_VERSION_NOT_PROVEN`, следующий root model
перестаёт использовать Operation provenance вообще. Источником причинной связи становится уже доказанный
GitHub Actions source run: exact `deploy-only-attempt` обязан иметь ровно один successful step
`Create exactly one read-only recovery Function version without invoking it`; его `started_at/completed_at`
задают узкое immutable source-step window. В этом окне provider read-only proof принимает только одну
version с recovery tag, exact active `GetVersionByTag` runtime/config fingerprint и один current
`ListTagHistory` record `tag -> functionVersionId` с тем же ID/effectiveFrom. Текущая tag mapping не
может иметь более позднего assignment. Operation list/Get и Audit Trails не участвуют.

Exact source-step + version/tag/history agreement разрешает только существующий write-free recovery invoke
по уже действующим marker/exact-main/history gates. Любая missing/ambiguous/config/time/history divergence
завершает flow fail-closed до Function invoke; create/redeploy/IAM/YDB/Google mutation, cleanup и replay
остаются запрещены. Один Incident-M включает classifier, workflow, source-step/history fixtures,
autocontinue changeset guard и синхронизацию runbook/AGENTS; это materially different provenance model,
а не ещё один discriminator прежнего Operation path.

Если merged reuse-source PR на exact-main заканчивается
`R1_RECOVERY_AUTOCONTINUE_REUSE_CHANGESET_INVALID`, recovery-провайдер не dispatch-ился и read-only
classification остаётся неиспользованной. Successor остаётся частью этого Incident-M: новый SHA,
неизменённый marker и три exact run IDs; regression test из marker должен быть включённым файлом PR
наряду с required recovery/caller tests, runbook и процессными docs. Единый changeset fixture охватывает
все допустимые caller/recovery predicates и заканчивается dispatch либо явным fail-closed stop; новый
marker enum/probe или same-SHA retry не добавляются.

Если autocontinue выдаёт `REUSE_SOURCE_RUN_NOT_EXACT`, сверить identity roles до следующего dispatch:
`Recovery-Run-ID` — оригинальный target failed recovery, `Recovery-Version-Run-ID` — успешный create-only
source для него, `Recovery-Classification-Run-ID` — exact latest failed reuse-verification predecessor.
Для текущего permission-attempt marker эти IDs соответственно `36341844854`, `36611387299`, `36709073723`.
Последний run и его deploy/invoke `skipped` phase должны быть подтверждены независимо от target run;
не подменять target ID тем preflight predecessor. Успех CI не разрешает recovery dispatch без совпадения
трёх identities и latest-source-relative history. Historical target verifier step может отсутствовать
(workflow version до reuse feature) либо быть единственным `skipped`; duplicate/failed verifier evidence
для target блокирует. Classification predecessor требует exact failed verifier + skipped deploy/invoke.

## Provider loop

После merge root-cause PR выполняется только этот bounded цикл:

`exact main -> CI PASS -> fresh recovery/readiness -> one provider attempt -> mandatory recovery/read-back -> handover`.

Один merged causal change даёт максимум один write-capable provider attempt.
Unknown/timeout/partial outcome не разрешает повтор; сначала только read-only recovery.

PR, который реально re-arm provider path, обязан использовать machine-readable contract из
`AGENTS.md` и связывать `Observed-Signature` с последним privacy-safe provider evidence.
Same-SHA replay запрещён.

Provider attempts не являются способом собирать telemetry. Telemetry должна быть собрана
настолько полно, насколько разумно, в рамках causal PR и его единственного attempt.

### Owner-authorized one-shot recovery Function deploy-only exception

После exact-run read-only classification `36554205552` Owner 2026-09-29 разрешил для failed
recovery run `36341844854` ровно одну новую recovery-only Function version create попытку. Она
вооружается только новым exact-main PR machine marker `OWNER_AUTHORIZED_SINGLE_RECOVERY_DEPLOY`,
canonical CI, exact latest failed-run/deploy-failed/invoke-skipped guards и single-writer lock.
Attempt создаёт только read-only recovery Function version; Function не вызывается, YDB и Google не
читаются/не меняются, IAM не меняется. Внешний error text остаётся в runner-temp; артефакт содержит
только allowlisted failure class/resource boundary enums.

Терминальные результаты `RECOVERY_FUNCTION_VERSION_CREATE_ACCEPTED_NO_INVOKE`, конкретный safe error
class или `PROVIDER_ERROR_DETAIL_UNAVAILABLE/OTHER` потребляют эту единственную authority. Workflow
проверяет cross-SHA history по exact failed run и не повторяется после достижения create step; успешное
создание не доказывает durable YDB state, `APPLIED`/`NOT_APPLIED` или `COMMITTED` и не авторизует invoke.
Следующее engineering решение принимается по конкретному enum: исправление кода для доказанного
invalid request; отдельная exact least-privilege authority boundary при доказанном missing permission;
stop/новая causal гипотеза для resource/policy/unclassified результата. Никакой retry, IAM widening,
YDB invoke, Google/YDB write, cleanup, timer или cutover не вооружаются автоматически. Этот узкий
explicit Owner exception не отменяет правило, что обычный diagnostic-only PR не вооружает provider
attempt. Если workflow остановился до deploy step на воспроизводимо доказанном preflight defect, это не
consumed provider attempt; поправка должна быть на distinct SHA, а guard допускает продолжение только
после доказательства `Deploy recovery-only Function version` = `skipped` для предыдущего run. Первый
preflight stop PR #870 вызван сравнением REST issue `state` с uppercase `OPEN`; exact recovery deploy
attempt не начинался. Successor на новом SHA принимает только точный failed run и единственную skipped
create step; success/failure/cancelled или missing/ambiguous job evidence потребляют/блокируют allowance.
Same-SHA replay и любая повторная попытка после входа в deploy step запрещены. Если до create было
несколько distinct-SHA preflight stops, continuation допускается лишь после точной классификации
каждого run/job/deploy step как `skipped`; один reached create или incomplete/ambiguous история
блокирует путь. Same-SHA replay запрещён независимо от заключения preflight. Same-SHA lookup исключает
собственный текущий workflow run по run ID, но ни один другой run на этом SHA.

После успешного owner-authorized `RECOVERY_FUNCTION_VERSION_CREATE_ACCEPTED_NO_INVOKE` create allowance
считается consumed, а durable YDB state остаётся не классифицированным. Следующая bounded read-only
recovery может использовать только эту accepted version: новый exact-main PR/marker связывает её с
успешным deploy-attempt run ID, история доказывает единственный reached create и `skipped` у всех
остальных попыток, а свежие tag/version/operation metadata должны доказать ту же активную private
recovery version. Reuse mode пропускает deployment и делает ровно один read-only invoke. Если version
provenance или конфигурация не доказаны, он завершает STOP до invoke и не повторяет deployment.
Reuse marker связывает точные failed `Recovery-Run-ID` и successful `Recovery-Version-Run-ID`;
autocontinue передаёт их только canonical recovery workflow, который повторно доказывает run history,
PR markers и exact provider version metadata. Reuse не создаёт Function version и вызывает только
write-free recovery handler один раз. Если operation metadata не связывает accepted create с unique
version, тот же causal boundary может использовать существующий read-only Cloud Logging
`CreateFunctionVersion` audit source; только exact actor/function/time/version, совпадающий с active tag и
runtime contract, закрывает provenance. Audit-source decision и все provider cases объединяются в одном
Incident-M; отсутствующий/неприменимый/непригодный/ambiguous источник завершает reuse до invoke.
Enum-only proof artifact сохраняется и на failed preinvoke, raw provider/financial payload не публикуется.
Все ожидаемые version metadata shapes и failed/missing/ambiguous
reuse outcomes закрываются вместе synthetic fixtures в одном Incident-M: exact version → durable
classification; unproven version → STOP without invoke/redeploy; classified durable state → отдельный
state-specific engineering next step. Не дробить этот boundary на enum-only refinements.
GitHub Actions run JSON may set `.name` to dynamic `run-name`/`display_title`, not the static workflow
name. Source identity must be bound by exact `/actions/workflows/<file>.yml/runs` provenance and
`workflow_id`; source/attempt history must not filter exact endpoint records against static `.name`.

## Постоянная делегация Owner до завершения R1

Owner делегирует агенту автономно принимать и выполнять repository/process/provider решения,
необходимые для доказательства completion target ниже. Не запрашивать Owner confirmation для каждой
causal hypothesis, явно разрешённого read-only probe, root-cause PR или one-shot provider action,
уже разрешённых существующими exact-main/marker/readiness/circuit gates. После fresh reconciliation
provider и Issue state выбрать следующий безопасный шаг и записать его в active R1 tracking Issue.

Эта постоянная делегация не обходит `AGENTS.md`, `MIGRATION_CONTRACT`, exact-main/CI/readiness,
single-writer, signature/circuit, fail-closed, privacy, financial invariants или обязательный recovery.
Неизвестное состояние остаётся неизвестным: нельзя предполагать `APPLIED`/`NOT_APPLIED`, выполнять
blind replay, cleanup или угадывать финансовые переходы. При ambiguous state разрешены только
stage-appropriate read-only classification и воспроизводимая repository root-cause работа. CUTOVER,
timer activation, YDB-authoritative production Writer, Google mutations/authority switch, `MEMBER`
activation, cap/IAM widening и retirement неоднозначных данных остаются вне делегации. Она
завершается только после доказательства R1 baseline, independent reconciliation, требуемого catch-up
и retirement временной R1 authority.

В пределах делегации разрешено без новых Owner confirmation продолжать bounded read-only diagnostic
refinement, в том числе для одного ранее неизвестного provider outcome, если каждый следующий probe
привязан к новому exact SHA и к новой causal гипотезе/изменённому diagnostic discriminator с
synthetic regression fixture. Same-SHA или неизменённый query повторять запрещено. Read-only probes
не увеличивают write-attempt circuit и не разрешают deploy/invoke; write-capable action по-прежнему
требует своего exact machine marker, CI/readiness, cause fix и mandatory recovery.

## Живой Google source

R1 не требует source freeze. Пользователь продолжает обычные записи в Google Sheets.

Initial bootstrap фиксирует immutable observation `A`. Успех — point-in-time `COMMITTED(A)`.
Изменения Google после cutoff не инвалидируют уже доказанный baseline только из-за нового digest;
они догоняются canonical incremental `A -> B`.

Нельзя бесконечно перезапускать bootstrap только потому, что Google остаётся живым.
## Completion target

R1 completion sprint не заканчивается на успешном workflow или закрытии одного Issue.
Нужны:
- доказанный initial `COMMITTED(A)`;
- independent privacy-safe reconciliation verified current;
- если authoritative source продвинулся — минимум один доказанный catch-up `A -> B`;
- отсутствие unexplained high-impact mismatch;
- Google всё ещё authoritative;
- timer/cutover/production Writer остаются отдельно gated.

После этого временные R1 provider authorities/diagnostics retires на natural boundary.

## Resume contract для ChatGPT/OpenCode

При `Продолжай R1` агент не начинает discovery заново и не продолжает из старой session memory.
Он делает minimal fresh reconciliation и читает:
- exact current `AGENTS.md`;
- этот документ;
- current R1 normative runbook;
- active R1 tracking Issue и последний `R1 SESSION HANDOVER`;
- последний relevant CI/provider/recovery result.

После этого продолжает ровно с `Next-Safe-Action`, если state не изменился.

## Handover format

На natural boundary публикуется один privacy-safe checkpoint:

```text
R1 SESSION HANDOVER
R1-Mode: COMPLETION_SPRINT
Writer: <CHATGPT|OPENCODE|OTHER|NONE>
Writer-State: <ACTIVE|PAUSED|HANDOFF|COMPLETE>
Main-SHA: <sha>
Active-Issue: <dynamic issue reference>
Active-PR: <pr|NONE>
Branch: <branch|NONE>
Head: <sha|NONE>
Last-Provider-Run: <run id|NONE>
Last-Safe-Signature: <allowlisted enums only>
Durable-State: <privacy-safe classification>
Provider-Attempt: <AUTHORIZED|NOT_AUTHORIZED>
Remaining-Hypothesis: <one causal hypothesis>
Next-Safe-Action: <one bounded action>
Owner-UAT: <YES|NO|NOT_REQUIRED>
```
Нельзя публиковать в handover financial rows, amounts, descriptions/notes, raw Google/YDB payload,
private identifiers, provider IDs, secrets или reconciliation totals.

Если `Writer-State=ACTIVE` принадлежит другому агенту и его branch/provider run ещё жив,
новый агент не становится вторым writer.

## Процессный stop condition

Completion sprint останавливается только при:
- доказанном R1 completion;
- Owner decision/authority boundary;
- реальном external blocker;
- ambiguous provider write outcome до read-only recovery;
- competing writer conflict.

Ожидание CI, необходимость следующего commit/PR, исправление теста или новый безопасный
root-cause шаг не являются причиной завершать работу статусным отчётом.
