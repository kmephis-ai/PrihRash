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
