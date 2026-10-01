# R1: первый initial shadow bootstrap Google → YDB

Статус этого runbook: manual-entry provider gate для #453. Основной Owner path — один ручной запуск `R1 initial bootstrap orchestrator`; отдельные readiness/bootstrap/recovery workflows остаются stage-specific provider primitives и не требуют ручной choreography владельца. Gate не включает timer, cutover или передачу authoritative роли YDB.

До завершения bootstrap и отдельного будущего cutover действует финансовая истина:

`Google authoritative → YDB shadow`.

Authoritative transactional source остаётся только `Ответы на форму (11)`.

## Что делает этот gate

Один ручной запуск `R1 initial bootstrap orchestrator`:

1. работает только из защищённого exact `main` canonical repository `kmephis-ai/PrihRash` и требует successful canonical CI на этом SHA;
2. собирает exact-main recovery-only Function artifact и через dedicated WIF deployment identity проверяет заранее подготовленную private trigger-free Function, runtime service account и dedicated Lockbox secret;
3. до любой новой write-capable попытки разворачивает exact read-only recovery version и выполняет durable classification;
4. разрешает продолжить orchestration только из `NOT_APPLIED / EMPTY_DURABLE_STATE`, `RECOVERY_REQUIRED / RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE` либо из отдельно вооружённого Incident-M `RECOVERY_REQUIRED / STAGING_RUN_PRESENT`;
5. автоматически dispatch-ит canonical `R1 Yandex readiness`, ждёт его завершения на том же exact SHA и проверяет short-lived enum-only `PASS / READINESS_READY` artifact;
6. повторно проверяет exact current `main`;
7. автоматически dispatch-ит существующий canonical `R1 initial shadow bootstrap` **ровно один раз**; сам bootstrap child сохраняет собственные #433/exact-main/readiness/provider gates, canonical `npm run check`, private trigger-free deployment и `--retry 0`;
8. считает успешным orchestration только successful bootstrap child, чей единственный successful invoke contract — sanitized `INITIAL_BOOTSTRAP_COMMITTED` после independent post-COMMITTED reconciliation;
9. если bootstrap child достиг invoke и завершился non-success/unknown, выполняет ровно одну read-only recovery classification в том же orchestrator run и останавливается;
10. никогда не выполняет второй bootstrap invoke, controlled rebuild, cleanup, timer, cutover или автоматическое расширение authority; публикует один short-lived privacy-safe orchestrator artifact.

Для доказанного Incident-M после прерванного application write orchestrator дополнительно может
принять явный input `allow_staging_resume=true`. Он разрешён только из
`RECOVERY_REQUIRED / STAGING_RUN_PRESENT`, передан autocontinue из проверенного PR marker
`Recovery-State: STAGING_RESUMABLE` и не отменяет runtime guards: application обязана на fresh
authoritative snapshot доказать exact manifest/source evidence, переиспользовать durable identities,
прочитать уже записанные revision evidence и записать только отсутствующее. Любое расхождение
остаётся fail-closed до новых writes. Default input — `false`.

Отдельный marker `Recovery-State: STAGING_STALE_RETIREABLE` требует отдельный explicit input `allow_stale_staging_retirement=true`; `allow_staging_resume=true` для него недостаточен. Этот stale-retirement input допускается только
для доказанного несовпадения authoritative snapshot digest. Внутри **одного** bootstrap Function
invoke первая application attempt обязана остановиться на `RESUME_CONTEXT_READ` до новых writes;
тогда runtime повторно читает authoritative source и допускает retirement только при единственном
`STAGING`, отсутствии `COMMITTED` baseline и exact-empty verified current. Отказ retirement
возвращает `REFERENCE_STALE_STAGING_RETIREMENT_FAILED` без нового bootstrap; successful retirement
разрешает ровно одну fresh application attempt. Это две application attempts в одном provider
invoke, а не два provider invokes. Старое append-only evidence сохраняется для диагностики.

`RECOVERY_REQUIRED / RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE` **не является самостоятельным разрешением replay**. Оно разрешает только войти в уже существующий guarded reference-aware bootstrap runtime: тот обязан на своём fresh authoritative snapshot повторно доказать exact `RESIDUAL_REFERENCE_STATE_WITHOUT_RUN → RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE → RESIDUAL_REFERENCE_STATE_WITHOUT_RUN` при `plannedWriteCount == 0`. Если это не доказано, runtime возвращает `REFERENCE_BOOTSTRAP_RECOVERY_UNSAFE` до application writes. Аналогично, `STAGING_RUN_PRESENT` без explicit Incident-M marker и `allow_staging_resume=true` всегда блокирует orchestrator.

Для `PARTIAL_CURRENT_RUN_ONLY` durable evidence трактуется узко: contiguous prefix доказывает только место, где persisted evidence заканчивается. Exact original revision-evidence batch/query из identity manifest не реконструируется, потому что production planner зависит от private revision payload byte size (`estimatedParameterBytes`), которого manifest не содержит. Нельзя публиковать prefix length/ordinal, угадывать batch index/end или использовать manifest-only evidence как replay plan.


### Pre-write readiness block на `2388247d28f7b8e8b5acfbeb2d26d5f50d7676c3`

Orchestrator `35313402330` на exact main `2388247d28f7b8e8b5acfbeb2d26d5f50d7676c3`
успешно выполнил initial read-only recovery и снова доказал
`RECOVERY_REQUIRED / STAGING_RUN_PRESENT`,
`R1_STAGING_REVISION_EVIDENCE=COMPLETE_CURRENT_RUN_ONLY`,
`R1_STAGING_DURABLE_REVISION_EVIDENCE=COMPLETE_CURRENT_RUN_ONLY`,
`R1_STAGING_RETIREMENT_EVIDENCE=STALE_STAGING_CURRENT_STATE_EMPTY` и
`R1_STAGING_SOURCE_DECODE_EVIDENCE=NONE`. Fresh readiness child `35313516727`
завершился до bootstrap с privacy-safe
`READINESS_INVOKE_NONZERO_UNCLASSIFIED / STDOUT_EMPTY__STDERR_TEXT / DEADLINE`
после исчерпания уже существующего одного bounded read-only retry. Bootstrap child не был
dispatch'нут, write-capable invoke не начинался, post-invoke recovery не требовалась и durable
financial state этим orchestrator run не менялся. Этот pre-write block не считается
distinct-SHA root-cause bootstrap attempt, потому что bootstrap invoke не был достигнут, но
повтор того же SHA остаётся запрещён общим Incident-M contract.

### Authority split after authoritative snapshot drift on `ccd616b895bfcf9fcae81b5934be3bec2a479dae`

Orchestrator `35328582211` read-only recovery впервые доказал
`AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH` при
`COMPLETE_CURRENT_RUN_ONLY` durable revision evidence и
`STALE_STAGING_CURRENT_STATE_EMPTY`. Это означает, что прежний `STAGING_RESUMABLE`
authority больше не соответствует fresh Google observation. Bootstrap child не был dispatch'нут:
fresh readiness child `35328699566` завершился до bootstrap с
`READINESS_INVOKE_NONZERO_UNCLASSIFIED / STDOUT_EMPTY__STDERR_TEXT / DEADLINE`.

Orchestrator обязан fail-closed различать два authority mode: обычный resume разрешён только exact
`COMPLETE_CURRENT_RUN_ONLY / COMPLETE_CURRENT_RUN_ONLY / STALE_STAGING_CURRENT_STATE_EMPTY / NONE`;
stale retirement требует отдельного `allow_stale_staging_retirement=true`, exact
`AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH`, empty verified current и непротиворечивое durable
revision evidence. Одновременное включение обоих flags запрещено.

### Recovery diagnostic stderr capture regression on `e1a21e6fbbf19c2f761c2bbb8896db58b2743ffa`

Autonomous orchestrator `35331443197` correctly received
`allow_staging_resume=false` and `allow_stale_staging_retirement=true`, and fresh recovery again
proved `AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH / COMPLETE_CURRENT_RUN_ONLY /
STALE_STAGING_CURRENT_STATE_EMPTY / NONE`. Nevertheless it stopped at
`R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED` before readiness/bootstrap.

Root cause is repository-side: `invoke-yandex-initial-bootstrap-recovery.mjs` intentionally emits
privacy-safe `R1_STAGING_*` diagnostics to stderr, while the new stale-authority guard from #613
attempted to parse them from the stdout capture containing the sanitized classification JSON.
The correction captures stdout and stderr separately in ephemeral runner files, validates exactly one
required diagnostic line per enum, republishes only the same allowlisted enum values, and keeps raw
provider output unpublished. No provider/runtime/financial semantics or write authority is widened.

### Shell prefix expansion regression on `5018c18ba4f0ecc646f24c4296c20359ae44e4f8`

Orchestrator `35332121430` stopped before readiness/bootstrap with
`FAIL / R1_BOOTSTRAP_ORCHESTRATOR_FAILED`. The stderr capture fix was present, but the generated
workflow contained `\${prefix}` inside double-quoted grep/sed patterns. Bash therefore searched for
the literal text `${prefix}` instead of expanding the diagnostic prefix, so exact recovery
diagnostics could not be admitted.

The correction removes only the accidental escape and adds a tooling regression assertion requiring
`^${prefix}=` expansion while rejecting `\${prefix}`. No provider/runtime/financial semantics,
authority, timeout, memory or caps change.

### HTTP 502 after complete revision evidence on `e676019027719808345f4a2800d1e765fe3a6703`

Orchestrator `35332679516` successfully proved stale retirement authority, readiness
`35332806306` returned `READINESS_READY`, and bootstrap child `35332935207`
reached the single provider invoke. The invoke ended with
`INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED / HTTP_502 / PRESENT`. Built-in post-recovery then proved
`STAGING_RUN_PRESENT / COMPLETE_CURRENT_RUN_ONLY / COMPLETE_CURRENT_RUN_ONLY /
STALE_STAGING_CURRENT_STATE_EMPTY / NONE`: stale retirement had advanced to a fresh resumable
STAGING run, verified current remained empty, and all revision-1 evidence for the current run was
durably complete.

The next bounded root-cause hypothesis is peak memory during `RECONCILIATION_READ`: the application
already retains observation/projection/lineage while revision resume verification historically
materialized every persisted `raw_payload` for the run in one YDB read. Exact payload verification
must remain fail-closed, but it is now split into a metadata-only run scan plus calibrated byte-bounded
key batches for raw-payload equality. This changes neither financial semantics nor durable evidence
requirements and does not increase Function memory/timeout/caps.

### Exact revision recovery preflight after `ac3518333d4d3df3904f1b8f12200e4b59ce6e4f`

Bootstrap child `35334490048` no longer failed at the previous process-level
`HTTP_502 / X-Function-Error` boundary. The sanitized runtime result was instead
`REFERENCE_APPLICATION_SEMANTIC_FAILED / REVISION_EVIDENCE_PREPARATION`.
The orchestrator's built-in post-recovery again proved a resumable STAGING surface:
current authoritative source matched the durable manifest, durable revision-1 evidence
was complete for the current run, verified current remained empty, and source decoding
had no blocker.

Because the remaining semantic failure occurs inside exact revision-resume preparation,
the next diagnostic boundary is read-only. Recovery now additionally compares the
persisted revision evidence against the authoritative STAGING expectation for
`observed_at`, row metadata, `change_class`, and canonical `raw_payload`, using
byte-bounded key batches. It emits only an enum
`R1_STAGING_EXACT_REVISION_EVIDENCE`; no row values, amounts, descriptions, notes,
identifiers, or reconciliation totals are exposed.

A normal `allow_staging_resume=true` orchestrator may arm only when this additional
diagnostic is `EXACT_CURRENT_RUN_MATCH`. Any other enum remains a recovery/root-cause
boundary and must not trigger a bootstrap invoke.

### Stale VALIDATED terminalization / Gate C writer guard

Stale-`VALIDATED` recovery uses the shared GitHub Actions concurrency group `r1-initial-bootstrap-writer` together with initial bootstrap and controlled-rebuild execution surfaces. `cancel-in-progress=false` means a competing dispatch may queue but cannot execute while standalone recovery owns the shared group. The orchestrator remains on its separate concurrency group and cannot be treated as proof of this shared writer boundary.

Serialization alone is insufficient because a queued ordinary bootstrap could otherwise start immediately after a later marker-only `VALIDATED → FAILED` terminalization. Therefore the normal bootstrap application performs a durable post-lock Gate C guard before any fresh claim. If any exact `FAILED / INITIAL_BOOTSTRAP_STALE_VALIDATED_SNAPSHOT` marker exists and there is no resumable incomplete run, it returns `RECOVERY_REQUIRED / STALE_VALIDATED_TERMINALIZATION_REQUIRES_GATE_C`. It does not allocate a new run/snapshot/identity set. Ordinary bootstrap remains fail-closed at this boundary.

Repository-side Gate C admission is separate: `runInitialBootstrapGateCApplication` requires no COMMITTED baseline, no STAGING/VALIDATED run, exactly one stale-VALIDATED terminal marker and empty canonical current before it can enter the existing fresh-bootstrap identity/claim pipeline. It preserves the historical FAILED run and its audit/staging/revision evidence; missing or multiple marker evidence stops before identity allocation. Ordinary bootstrap continues to use the normal admission and therefore remains blocked by `STALE_VALIDATED_TERMINALIZATION_REQUIRES_GATE_C`.

#### Production Gate C one-shot authority (Owner 2026-09-21)

Owner separately authorized one production Gate C attempt under Issue authority `R1_GATE_C_FRESH_BOOTSTRAP_ONCE`. The production surface is deliberately narrow:

- `initialBootstrapGateCHandler` reuses the same reference-aware source/YDB/reconciliation engine, but selects only `runInitialBootstrapGateCApplication`; it does not expose stale-STAGING retirement or cleanup;
- `.github/workflows/r1-initial-bootstrap-gate-c.yml` runs only after successful push `CI` on exact current `main`, from one merged same-repository PR whose exact authority markers bind it to an open Gate C tracking Issue and its open parent R1 WU7 Issue;
- the workflow shares `r1-initial-bootstrap-writer` with ordinary bootstrap, Gate B and standalone recovery, uses `cancel-in-progress=false`, rejects workflow reruns, and rejects a second Gate C workflow run for the same source SHA;
- before any Gate C Function deployment it dispatches one fresh exact-main `R1 Yandex readiness` child and requires enum-only `PASS / READINESS_READY`;
- before deployment and again immediately before invoke it re-proves exact current `main` and active Gate C authority; provider preflight re-proves the dedicated Function is private, trigger-free, WIF-invokable, uses the dedicated runtime service account and active Lockbox secret;
- the deployed version uses the reviewed bootstrap package, dedicated entrypoint `index.initialBootstrapGateCHandler`, the existing private `r1-initial-bootstrap` tag and the unchanged `256m / 600s / --retry 0 / --no-logging` bootstrap envelope;
- the workflow invokes the bootstrap HTTPS surface exactly once. `PASS / INITIAL_BOOTSTRAP_COMMITTED` is accepted only because the existing job performs independent post-COMMITTED reconciliation before returning PASS; any NOOP/STOP/FAIL/transport-unknown result terminates the workflow and does not dispatch a second bootstrap, controlled rebuild, cleanup or replay;
- published GitHub evidence is restricted to the sanitized enum-shaped invoker result. Raw provider output, financial rows/amounts/descriptions/notes, IDs, digests and reconciliation totals are not published.

This one-shot Gate C authority still does **not** authorize timer/scheduled sync activation, cutover, YDB-authoritative production Writer, cap increase, cleanup/retirement or Google mutation. A non-success/unknown live result becomes a recovery boundary; any later write-capable attempt requires a new explicit authority decision.

##### Live Gate C result on `bc511f61176ae7d7cb89cf0c6ae1ccbf2bde06e3`

Gate C run `35540608663` consumed the one-shot authority after fresh readiness `35540630148` and all exact-main/private-trigger-free checks passed. The only live invoke returned `STOP / INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED`; no second invoke or replay occurred and Issue #699 was closed as consumed. The application reaches this enum only after the fresh STAGING claim and revision-evidence writes have completed successfully, but before the `VALIDATED` transition or current promotion.

Read-only recovery `35541085684` then returned `RECOVERY_REQUIRED / FAILED_RUN_PRESENT`. This did not prove a generic new failure: the generic recovery probe counted the already-proven Gate B `FAILED / INITIAL_BOOTSTRAP_STALE_VALIDATED_SNAPSHOT` marker as an unsafe failed run before it could expose the active Gate C run. The bounded successor is therefore read-only classification only: distinguish that exact terminal history from unknown FAILED rows and re-run recovery. No controlled rebuild, Gate C replay, cleanup, timer, cutover or production Writer follows from this diagnostic correction.

This mechanism does not prove Gate A condition 6 and does not by itself complete condition 7 or authorize marker terminalization. Gate B already used the shared writer lock continuously from fresh Gate A preflight through terminal marker read-back. The ordinary guard plus dedicated Gate C admission prevent queued/late bootstrap execution from crossing the B→C boundary without the separate Gate C path and authority gate.

### Temporary read-only recovery autocontinue

While #453 is active, a merged `R1 #453:` PR may request exactly one fresh standalone
read-only recovery on its exact merge SHA with the marker `Recovery-Probe: READY`.
The marker is valid only together with `Provider-Attempt: NOT_AUTHORIZED` and
`Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION`. After a write-capable
non-success whose post-invoke recovery also fails, the exact pair
`Expected-Transition: READ_ONLY_DURABLE_CLASSIFICATION` and
`Recovery-State: UNKNOWN_AFTER_NON_SUCCESS` is also valid for a read-only probe.

The stage-specific `R1 initial bootstrap recovery autocontinue` workflow runs only after a
successful push-CI on exact `main`, requires Issue #453 to remain open, refuses a concurrent
orchestrator/bootstrap writer, refuses a same-SHA recovery replay, and can dispatch only the
canonical `r1-initial-bootstrap-recovery.yml`. It cannot dispatch readiness, orchestrator, or
bootstrap. This workflow exists only to remove the current control-surface gap where the connected
GitHub client cannot create a fresh `workflow_dispatch`; it retires together with the R1
autocontinue/provider surface after #453.

If a surface-only unknown-outcome probe returns only
`RECOVERY_REQUIRED / STAGING_RUN_PRESENT`, the durable surface is known but resume/retirement
safety is still unclassified. A successor diagnostic-only PR on a new SHA may use
`Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION` with
`Recovery-State: STAGING_PRESENT_UNCLASSIFIED`. Recovery autocontinue then dispatches the normal
full read-only recovery (not `surface_only`) exactly once. No readiness, orchestrator, bootstrap,
cleanup, or write authority follows from this marker.

### Exact revision AS_TABLE readback seam on `83b3e201d47780007a0013fe2d643039d8e5344a`

Autonomous read-only recovery `35338326938` on exact current main proved the durable surface still
`STAGING_RUN_PRESENT / COMPLETE_CURRENT_RUN_ONLY / COMPLETE_CURRENT_RUN_ONLY /
STALE_STAGING_CURRENT_STATE_EMPTY / NONE`, while the new exact preflight returned
`EXACT_CURRENT_RUN_REVISION_MALFORMED`. Because the ordinary run-scoped durable read successfully
validated the same revision identity/metadata fields, the malformed result is localized to the
`AS_TABLE($source_keys)` exact-payload join path also used by application resume.

Exact current-run payload verification therefore no longer joins all expected keys through
`AS_TABLE`. It uses scalar source-id predicates together with exact `migration_run_id`, batching
dynamically by both the existing 512 KiB response-memory envelope and 8 KiB query-text envelope.
The `AS_TABLE` key join remains only as a metadata-only collision probe for source IDs that are
actually missing from the current run. No row cap, retry, timeout, memory, financial semantics, or
authority is widened.

### Pre-write authoritative drift on `3fc089fbc4d33783dbeecc152383efbd030407f1`

Root-cause fix #619 was armed correctly after its Incident-M signature metadata was normalized to
`REFERENCE_APPLICATION_SEMANTIC_FAILED/REVISION_EVIDENCE_PREPARATION`. Autocontinue dispatched
orchestrator `35341879483` on exact main. The orchestrator stopped during its initial read-only
recovery, before readiness and before any bootstrap child/invoke. Fresh privacy-safe evidence was:

- `AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH`;
- durable revision evidence `COMPLETE_CURRENT_RUN_ONLY`;
- verified current `STALE_STAGING_CURRENT_STATE_EMPTY`;
- source decode `NONE`;
- exact revision source proof `EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN`.

This is not a failed test of #619 and must not count as a root-cause bootstrap attempt. The
authoritative Google snapshot changed before the write boundary, so the proven state is again
`STAGING_STALE_RETIREABLE`.

To avoid fake code changes or same-SHA replay, a bounded successor may use the exact pre-write
signature
`R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED/RECOVERY_REQUIRED/STAGING_RUN_PRESENT`,
`Recovery-State: STAGING_STALE_RETIREABLE`, and
`Circuit-Rearm: SOURCE_DRIFT_REBASE`. Autocontinue accepts this rearm only when the canonical
runbook is updated on the new SHA and dispatches the orchestrator with resume disabled and stale
retirement enabled. Source-drift rebase is not included in the two-attempt Incident-M root-cause
counter.

### Post-WU7 source drift rebase preflight on `343de24b0822336e3e061b5d3846820eadcfd2f0`

After WU7 controlled rebuild `36032087423` failed in
`PREPARATION / RECONCILIATION_READ`, full read-only recovery `36138207398` on exact main
`102a56b690ff2fde232ab3e2c33f82c4b9724bef` proved authoritative digest mismatch, complete
durable revision evidence, stale staging with empty verified current, source decode `NONE`, and
`EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN`.

Successor orchestrator `36139781599` on exact main
`343de24b0822336e3e061b5d3846820eadcfd2f0` was dispatched with both staging flags disabled. Its
fresh initial read-only recovery reproduced
`R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED / RECOVERY_REQUIRED / STAGING_RUN_PRESENT` and the
same five allowlisted diagnostics above. `readinessRunId=null` and `bootstrapRunId=null`; neither
readiness nor a bootstrap child was dispatched. This pre-write stop is not a root-cause bootstrap
attempt.

The exact source-drift rebase marker on the next distinct SHA may therefore arm only one orchestrator
with `allow_staging_resume=false` and `allow_stale_staging_retirement=true`. It is authorized solely
by the fresh digest mismatch + empty verified current evidence, requires this runbook entry and the
canonical autocontinue regression guard, and does not authorize a controlled-rebuild replay, cap
increase, cleanup of ambiguous financial state, timer, or cutover. If retirement or subsequent fresh
bootstrap does not reach an exact safe result, the orchestrator must stop and publish only its
privacy-safe recovery evidence.

### Post-invoke recovery leaves staging unclassified on `7a5c54dc5027cb9790ee4b0973287cbdf0b4c6f0`

The bounded source-drift rebase dispatched orchestrator `36141234938` on exact main. Initial
read-only recovery allowed only guarded stale retirement; readiness `36141385920` returned
`READINESS_READY`; bootstrap child `36141543533` reached the write-capable invoke and failed. The
mandatory post-invoke read-only recovery succeeded as a workflow but returned only
`RECOVERY_REQUIRED / STAGING_RUN_PRESENT`:

- `status=STOP`, `code=R1_BOOTSTRAP_ORCHESTRATOR_POST_INVOKE_RECOVERY_CLASSIFIED`;
- `bootstrapInvokeStep=failure`;
- `postRecoveryVerdict=RECOVERY_REQUIRED`, `postRecoveryReason=STAGING_RUN_PRESENT`;
- `stagingResumeAuthorized=false`, `staleStagingRetirementAuthorized=true`.

This does not classify durable state as resumable or stale-retireable. The successor may request
exactly one full read-only recovery on a new exact SHA using
`Provider-Attempt: NOT_AUTHORIZED`, `Recovery-Probe: READY`,
`Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION`, and
`Recovery-State: STAGING_PRESENT_UNCLASSIFIED`, with regression guard
`tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs`. This marker does not
authorize readiness, orchestrator, bootstrap, resume, cleanup, or authority change. Continue only
from fresh privacy-safe full-recovery classification; if that probe does not produce an exact
allowlisted durable classification, stop without another provider attempt.

### Root-cause correction for post-invoke HTTP 502 on `34e58d178638b65516ba16f981407b8f65d35f0c`

Full read-only recovery `36149776621` proved the following privacy-safe diagnostics:

- `AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH`;
- durable revisions `COMPLETE_CURRENT_RUN_ONLY`;
- verified current `STALE_STAGING_CURRENT_STATE_EMPTY`;
- source decode `NONE`;
- exact revision source `EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN`.

Bootstrap child `36141543533` returned only
`INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED / HTTP_502 / functionError=PRESENT`, without an application
phase. Durable state remained the same single STAGING run with empty verified current. This does not
authorize replay, retirement, or resume.

The bounded repository-side hypothesis is avoidable source-memory retention during initial bootstrap:
the job kept the full Google snapshot lease reachable while the application ran, and the
reference-aware runtime independently projected that same snapshot again to build reference-planning
rows. A process-level HTTP 502 with no application enum is consistent with that peak-memory surface,
but does not itself prove memory exhaustion. The correction derives reference planning rows from the
already-built canonical observation and confines the full lease/reader to a helper that returns only
that observation. It removes the duplicate full projection and releases the raw lease before YDB
application work; reference ordering, row payloads, digest, historical evidence, identity planning,
financial writes, caps, retry semantics, Function resources, and authority remain unchanged.

The successor requires a synthetic integration regression proving that the exact observation produced
from the source lease is passed unchanged to reference planning and application in the existing order.
Any automatic live attempt remains subject to the exact signature/circuit and fresh recovery guards;
this hypothesis alone does not authorize an invoke.

### Full classification required after repeated HTTP 502 on `ab1708c427ee9bad8b43dc6841c87afd7cff32df`

The exact-source root-cause candidate passed CI and autocontinue selected one orchestrator
`36154418182`. Fresh readiness `36154623727` returned `READINESS_READY`; bootstrap child
`36154779191` reached invoke and returned the same
`INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED / HTTP_502 / functionError=PRESENT`. The mandatory embedded
post-invoke recovery only returned `RECOVERY_REQUIRED / STAGING_RUN_PRESENT`, with
`stagingResumeAuthorized=false` and `staleStagingRetirementAuthorized=true`. This does not prove
whether the new snapshot reduction changed durable state and does not authorize another bootstrap.

The next successor may request exactly one full read-only recovery on a new exact SHA using
`Provider-Attempt: NOT_AUTHORIZED`, `Recovery-Probe: READY`,
`Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION`, and
`Recovery-State: STAGING_PRESENT_UNCLASSIFIED`. It may dispatch only the recovery workflow. Any
subsequent root-cause write path must be blocked or freshly authorized from the exact recovery
classification and deterministic signature history; no blind replay, cleanup, or cutover is allowed.

### Full recovery confirms unchanged durable diagnostics on `9ac9e55b64ab71f9fd75134080982b69024714db`

Full read-only recovery `36156171335` returned
`PASS / INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED / RECOVERY_REQUIRED / STAGING_RUN_PRESENT` and the
same exact diagnostics as the prior recovery:

- `AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH`;
- durable revisions `COMPLETE_CURRENT_RUN_ONLY`;
- verified current `STALE_STAGING_CURRENT_STATE_EMPTY`;
- source decode `NONE`;
- exact revision source `EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN`.

The state remains unclassified for resume/retirement permission purposes. The HTTP 502 signature
survived the source-lifetime correction; this read-only result does not authorize another bootstrap.
Before any next automatic provider cycle, the cross-run root-cause circuit must count only exact
distinct-SHA attempts that actually reached invoke and determine whether it requires
`BLOCKED_NEEDS_ROOT_CAUSE`. Any follow-up is diagnostic-only until a separate deterministic root
cause is fixed and its marker passes that guard.

### Bounded memory-envelope root-cause candidate after repeated HTTP 502 on `280ea864d561b7b450e41b204b6b53371051888b`

Full recovery `36157603929` on exact main `280ea864d561b7b450e41b204b6b53371051888b` repeated the
same five diagnostics: authoritative digest mismatch, complete durable revisions, exact-empty
verified current, source decode `NONE`, and exact current source `NOT_PROVEN`. Bootstrap child
`36154779191` on the preceding exact SHA still returned `HTTP_502 / functionError=PRESENT` after the
source-lifetime reduction; no application phase or durable transition was observed.

The remaining bounded hypothesis is that the canonical observation plus required application
projection still exceeds the write-capable Function's existing `256m` memory envelope. This is not
directly proven by the HTTP header, so the next candidate changes only that dedicated bootstrap
version to `1g`, matching the already-used read-only recovery envelope. Function execution timeout
remains `600s`, retry stays disabled, and YDB/Google semantics, write set, schema, IAM, triggers, and
authority do not change. The deployment remains one-shot and non-scheduled. If exact signature,
recovery, or circuit evidence does not arm it, no provider attempt follows.

### Full read-only classification required after memory-envelope attempt on `388c13db5d55bb7ea97d1ba965c8d5ef5e05384e`

The bounded 1g bootstrap Function attempt dispatched orchestrator `36159628640` on exact main.
Fresh readiness `36159801476` returned `READINESS_READY`; bootstrap child `36159946320` reached the
single invoke and changed the failure signature to
`INITIAL_BOOTSTRAP_RUNTIME_FAILED / REFERENCE_APPLICATION_SEMANTIC_FAILED /
REVISION_EVIDENCE_PREPARATION`. The mandatory embedded post-invoke recovery only classified
`RECOVERY_REQUIRED / STAGING_RUN_PRESENT`, with resume unauthorized. This proves the Function now
returned a sanitized application failure rather than HTTP 502; it does not classify durable exact
revision evidence and does not authorize replay.

The next allowed operation is one full read-only recovery on a new exact SHA using
`Provider-Attempt: NOT_AUTHORIZED`, `Recovery-Probe: READY`,
`Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION`, and
`Recovery-State: STAGING_PRESENT_UNCLASSIFIED`. No bootstrap or resume follows from the new error
signature until fresh recovery and cross-run circuit evidence have been reviewed.

### RESOURCE_EXHAUSTED in application revision payload batch on `b729820a10890707e3bc5b0116ca9d4d4af6c253`

Read-only recovery `36161751076` on exact main again proved digest mismatch, complete durable
revisions, empty verified current, source decode `NONE`, and exact source `NOT_PROVEN`. The separate
controlled-preparation-only read-only diagnostic `36163186003` returned:

- `YDB_DATA_QUERY_EXECUTION_FAILED` after retry `RETRIED`;
- phase `RECONCILIATION_READ`;
- reconciliation stage `REVISION_PAYLOAD_BATCH`;
- query error `GRPC_STATUS / RESOURCE_EXHAUSTED`;
- reference read stage `VIKA_MEMBER_READ`.

This localizes the 1g application's sanitized
`REFERENCE_APPLICATION_SEMANTIC_FAILED / REVISION_EVIDENCE_PREPARATION` to the exact-payload batch
query. The application-resume source path still used `AS_TABLE($source_keys)` for exact payload
verification while read-only recovery had been optimized to UUID primary-key ranges. The first bounded
correction aligned application resume to that proven range-read strategy, but controlled-preparation
probe `36171271614` on exact main `3eeb7e90c5fc15c1a696883629047855b69d0bda` still returned
`RESOURCE_EXHAUSTED / REVISION_PAYLOAD_BATCH` with the old 512 KiB range batch envelope.

The successful initial-bootstrap run reached `CONTROLLED_REBUILD_REQUIRED`, but the separate
read-only controlled-preparation probe `36171271614` still saw resource exhaustion on a 512 KiB
payload batch even after moving the application query to primary-key ranges. The bounded root-cause
fix lowers only `REVISION_EVIDENCE_READ_BATCH_BYTES_LIMIT` to 64 KiB. The byte-derived batching
strategy, exact range semantics, YDB-returned order and payload verification remain unchanged; it is
not a row cap, and an individual larger source payload is never split or silently accepted.

A synthetic adapter fault fixture returns `YDB RESOURCE_EXHAUSTED` when one exact-range batch exceeds
96 KiB, then proves byte-sized 64 KiB batches complete with exact payload equality. This threshold is
fixture-only, not asserted as a YDB provider quota. `AS_TABLE` remains only for the metadata-only
collision check of expected IDs that were missing from the exact run scan. The historical #625 summary
overstated that application resume had already adopted range reads; this Incident-M ports and bounds
the actual production path. It does not widen retries, timeouts, write set, schema, financial semantics
or authority.

This corrective PR authorizes no bootstrap invoke. After merge, a fresh full recovery runs on exact main;
then a read-only controlled-preparation probe must pass the revision payload phase before the separate
WU7 Issue #630 authority is exercised.

The full-recovery successor uses the read-only marker:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

### Full classification required after `CONTROLLED_REBUILD_REQUIRED` on `79fdc6e669c16e8fb363eac4f28edc679f72f113`

The guarded range-read successor dispatched orchestrator `36168126324` on exact main
`79fdc6e669c16e8fb363eac4f28edc679f72f113`. Fresh readiness `36168296429` returned
`READINESS_READY`; bootstrap child `36168468708` returned
`STOP / INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED` after the single invoke. The orchestrator's
mandatory post-invoke recovery only classified `RECOVERY_REQUIRED / STAGING_RUN_PRESENT`; therefore
the exact durable stage is not yet independently classified.

The next safe operation is exactly one full read-only recovery on a new exact SHA using
`Provider-Attempt: NOT_AUTHORIZED`, `Recovery-Probe: READY`,
`Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION`, and
`Recovery-State: STAGING_PRESENT_UNCLASSIFIED`. No further ordinary bootstrap follows. If recovery
confirms a valid resumable STAGING requiring promotion beyond the atomic budget, controlled rebuild
must proceed only under its separate open #630 authority and exact provider/circuit contract; do not
infer that authority from `CONTROLLED_REBUILD_REQUIRED` alone.

### 64 KiB revision-batch diagnostic after repeated `RESOURCE_EXHAUSTED` on `05c5578d5c409f4268fe7dd321f6ccaf96f597c0`

Full read-only recovery `36177432399` on exact current `main` returned
`PASS / INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED / RECOVERY_REQUIRED / STAGING_RUN_PRESENT`.
Controlled-preparation-only recovery `36177689818` on the same SHA also completed as a workflow,
but classified the application preparation as
`YDB_DATA_QUERY_EXECUTION_FAILED / RETRIED / GRPC_STATUS / RECONCILIATION_READ /
REVISION_PAYLOAD_BATCH`. It did not authorize writes or change durable state.

The previous 64 KiB correction did not remove the provider failure. The next bounded diagnostic
reports only one enum describing the exact payload-read plan:

- `NO_PAYLOAD_BATCH`;
- `ALL_BATCHES_WITHIN_64_KIB`;
- `SINGLE_REVISION_EXCEEDS_64_KIB`;
- `UNOBSERVED` or `DIAGNOSTIC_FAILED` when planning evidence is unavailable.

The observer cannot alter queries, retries, writes, or reconciliation results. It emits no row
values, payload sizes, source identifiers, or provider exception text. `SINGLE_REVISION_EXCEEDS_64_KIB`
is a sizing classification, not permission to split one payload or weaken exact verification. All
other results likewise authorize no bootstrap/rebuild invoke; they only determine the next diagnostic
boundary. The recovery workflow persists this allowlisted enum separately and remains manual,
exact-main, and read-only.

For this diagnostic successor, the permitted provider action is one fresh controlled-preparation-only
read-only recovery on its exact merged main SHA after canonical CI. A `READY` result is not a pass
unless its exact enum evidence is reviewed; `RESOURCE_EXHAUSTED` or absent evidence means STOP and a
new bounded root-cause analysis. Full recovery must still be run separately after this probe because
the controlled-preparation-only probe does not replace durable classification. No readiness,
orchestrator, bootstrap, controlled rebuild, cleanup, timer, or cutover is authorized by this entry.

The merged diagnostic PR may request only one full read-only classification through recovery
autocontinue, using the existing marker pair `Expected-Transition:
READ_ONLY_EXACT_REVISION_CLASSIFICATION` and `Recovery-State: STAGING_PRESENT_UNCLASSIFIED`.
That successor must use a distinct exact SHA and the canonical regression guard
`tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs`; it does not arm
controlled preparation, readiness, orchestrator, bootstrap, or controlled rebuild.

#### Controlled-preparation probe on `991bcd61f24afc510e3d3c8b1e07221fe5ddc958`

The single controlled-preparation-only read-only recovery `36221325448` completed, but did not
reach revision payload planning. Its sanitized evidence was:

- durable surface: `PASS / INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED / RECOVERY_REQUIRED / STAGING_RUN_PRESENT`;
- preparation: `APPLICATION_BOOTSTRAP_OBSERVATION_INVALID`;
- phase: `RESUME_CONTEXT_READ`;
- reference read stage: `VIKA_MEMBER_READ`;
- query error: `GRPC_STATUS`, status `RESOURCE_EXHAUSTED`, retry `RETRIED`;
- revision payload batch: `UNOBSERVED`.

Thus the 64 KiB payload-batch hypothesis was not evaluated by this probe; this result neither
confirms nor refutes it. The fresh failure is earlier and localized to the Vika family-member
reference read. Do not repeat controlled preparation, dispatch WU7, or infer resume/rebuild safety
from the durable surface enum alone. The next action requires a deterministic repository-side cause
for the bounded reference-read failure plus its synthetic adapter fixture and focused regression
coverage, followed by one newly authorized read-only classification on a distinct exact SHA. No
bootstrap invoke, replay, cleanup, timer, or cutover is authorized.

#### Bounded reference-read correction candidate on `73b7ce18eb5b50c033289d3bbf8c89233a8ae5d9`

The observed failure is the third sequential `READ` (`family_members`) inside one
`serializableReadWrite` resolver transaction, after the account and category reads succeeded. The
candidate correction reduces this resolver snapshot to one read-only tagged `UNION ALL` statement
over the same three physical tables. It preserves exact account/category/member filters and existing
row validators, uses the single statement's snapshot instead of a multi-query transaction snapshot,
and makes no schema, data, writer, retry, RU-cap, or authority change.

The synthetic adapter fixture reproduces `RESOURCE_EXHAUSTED` on the third legacy transaction query
and verifies the new resolver issues one request and returns the exact same validated resolver.
Unknown row tags still fail closed. This is a bounded hypothesis tied to the observed failing stage,
not a claim that the provider quota or gRPC cause is proven. After merge and successful exact-main CI,
one fresh full read-only recovery and one controlled-preparation-only read-only probe are required;
the latter must reach `REFERENCE_SNAPSHOT_READ` and then prove controlled preparation passes the
revision payload phase. Any repeat `RESOURCE_EXHAUSTED` or absent evidence is STOP; it does not
authorize WU7, bootstrap replay, or cap increase.

#### Reference snapshot validation classification gap on `450b6761bf59383c644c918223b5274542ae119d`

After #802, fresh full read-only recovery `36225185084` again returned
`PASS / INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED / RECOVERY_REQUIRED / STAGING_RUN_PRESENT`.
One controlled-preparation-only read-only probe `36225371541` returned:

- preparation `DIAGNOSTIC_FAILED`;
- reference stage `REFERENCE_SNAPSHOT_READ`;
- phase, query-error, gRPC status and revision batch `UNOBSERVED`;
- retry `NO_RETRY`.

The previous `RESOURCE_EXHAUSTED` did not recur, but this result does not prove the combined
statement's parsed references were valid. The recovery surface currently collapses typed reference
reader/resolver validation errors into `DIAGNOSTIC_FAILED`. The bounded successor adds an allowlisted
reference-validation enum for those existing typed error codes; it does not publish SQL results,
provider error text, IDs, labels, or financial payload. Do not repeat the provider probe until that
diagnostic contract is merged and exact-main CI passes. Afterward, one new controlled-preparation-only
read-only probe may classify this boundary; only `REFERENCE_SNAPSHOT_VALIDATED` plus `READY` and a
revision phase beyond the payload read advances toward WU7 preflight. Any validation enum, diagnostic
failure, or missing evidence remains STOP.

#### Reference row-kind diagnostic split on `8f99d2fb2657abbeab5138a0b827730560745c56`

The single controlled-preparation-only read-only probe `36227316895` returned
`DIAGNOSTIC_FAILED` with reference evidence `REFERENCE_READER_MALFORMED_REFERENCE_SNAPSHOT_EVIDENCE`;
the reference statement stage was observed, while transport/query status, application phase and
revision batch were unobserved. This is a typed parser failure from the exact tagged-row contract,
not another YDB resource-exhaustion result. The bounded successor separates only whether the
allowlisted tag field is missing or has an unrecognized value (`REFERENCE_SNAPSHOT_KIND_MISSING` /
`REFERENCE_SNAPSHOT_KIND_UNKNOWN`); it still never emits the tag value, row data, or provider text.

After its merge and exact-main CI, one full read-only classification may run, followed by one
controlled-preparation-only read-only probe on that new SHA. No writer/WU7 path is permitted from
either result; inspect the new enum and fix the tagged response contract before any further probe.

#### Numeric reference-row tags after `REFERENCE_SNAPSHOT_KIND_UNKNOWN` on `0e67ba079ff2d259c1054fd772d0b201065e595b`

Full read-only recovery after #804 again classified only
`PASS / INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED / RECOVERY_REQUIRED / STAGING_RUN_PRESENT`.
Controlled-preparation-only probe `36228428540` returned:

- `DIAGNOSTIC_FAILED`;
- reference evidence `REFERENCE_READER_REFERENCE_SNAPSHOT_KIND_UNKNOWN`;
- stage `REFERENCE_SNAPSHOT_READ`;
- transport/query and revision diagnostics `UNOBSERVED`.

The tagged query returned a present row-kind value that did not match its allowlist. The successor
uses explicit `CAST(1|2|3 AS Uint32)` tags for account/category/Vika rows and integer comparisons in
the parser, keeping each SQL branch and all financial/reference validators unchanged. A synthetic
adapter fixture verifies the exact integer-tag projection and still rejects every other tag. This
candidate does not claim the provider's previous tag representation or YDB query type; one new
controlled-preparation-only read-only probe will verify it on a distinct exact SHA. Only
`REFERENCE_SNAPSHOT_VALIDATED` followed by `READY` and a revision phase past payload verification
allows consideration of WU7 preflight. All other results stay read-only STOP.

#### Metadata-scan RESOURCE_EXHAUSTED after numeric reference tags on `0b810880d3e5dea4db1ccd52b66cf0d4de1cde68`

Controlled-preparation-only probe `36230537420` now returned
`REFERENCE_SNAPSHOT_VALIDATED`, so the reference resolver stage completed. The next failure moved to:

- preparation `YDB_DATA_QUERY_EXECUTION_FAILED`;
- phase `RECONCILIATION_READ`;
- reconciliation stage `REVISION_METADATA_SCAN`;
- query error `GRPC_STATUS / RESOURCE_EXHAUSTED`, retry `RETRIED`;
- revision payload batch `UNOBSERVED`.

This localizes the current provider failure to reading all current-run revision metadata in one
unbounded result. The bounded candidate pages that same run+revision secondary-index scan by
`source_record_id` with a 128-row **per-query** limit and follows provider-returned order until an
empty/short page. Every page is validated; persisted evidence outside the authoritative expected set,
duplicates, or cursor anomalies remain fail-closed. The page limit does not cap total reconciliation
coverage, truncate source history, or weaken exact payload verification. The synthetic adapter fixture
exhausts an unpaged response envelope and proves all pages still produce exact complete evidence.

After merge and exact-main CI, perform one fresh full read-only classification and one
controlled-preparation-only read-only probe on that distinct SHA. Continue only if the snapshot
reference is validated, preparation is `READY`, and exact revision payload verification completes.
Otherwise preserve the new enum-only stage/error and fix that boundary before any WU7 mutation.

### Unknown durable outcome after bootstrap invoke on `ca536788f712025e15476a9677da50138da555da`

Orchestrator `35342705006` first classified the prior staging run as stale using fresh read-only
evidence. Readiness child `35342816957` succeeded. Bootstrap child `35342931292` reached the
write-capable invoke and failed; orchestrator post-invoke recovery then failed with
`R1_BOOTSTRAP_ORCHESTRATOR_POST_RECOVERY_FAILED`. These signals do not establish whether the
durable YDB state is committed, staged, or unchanged. Before any further provider write, run
one standalone read-only recovery on a new exact main SHA and inspect its privacy-safe result.
No replay, cleanup, or authority switch is authorized by this observation.

Standalone recovery `35344633163` on successor `00baa2c80fd649f909b221a0d165f0702130fa57`
passed its exact-main and provider read-only guards but the invoke ended after roughly 153 seconds
with `INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILED`, before enum-only classification. Its durable
outcome remains unknown. The bounded successor requests `surface_only=true` for the existing
recovery workflow: classify the durable YDB surface without Google snapshot or per-revision
staging diagnostics. `STAGING_RUN_PRESENT` from this reduced probe does not establish resume,
retirement, or cleanup safety; those still require their full fresh diagnostics. The function
execution timeout and provider write permissions remain unchanged.

Standalone surface-only recovery `35345833061` on
`84952acc409b301184d3f43a6a782704e45d6125` returned
`PASS / INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED / RECOVERY_REQUIRED / STAGING_RUN_PRESENT`.
Because surface-only mode intentionally omits fresh Google and per-revision diagnostics, this proves
only that one STAGING run is durably present; it does not prove whether that run is resumable or
stale-retireable. The next bounded action is therefore one full read-only recovery on a successor
exact SHA using the `STAGING_PRESENT_UNCLASSIFIED` marker above.

### Full recovery timeout after surface-only STAGING classification on `7579f2cc795327b7b3a1efa554fa681ff8e4c23d`

Surface-only recovery `35345833061` had already proved
`RECOVERY_REQUIRED / STAGING_RUN_PRESENT`. Successor #624 then dispatched the normal full
read-only recovery `35351802811` on exact current main. All repository, OIDC, provider-boundary,
private trigger-free deployment and exact-main checks passed, but the single recovery invoke ended
after the existing bounded recovery window with
`INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILED`. No write-capable workflow was armed or invoked.

The remaining timeout is localized to the Google-aware/per-revision diagnostic path. After #619,
both exact recovery and application resume verified current-run `raw_payload` with scalar
`source_record_id = ... OR ...` predicates. The 8 KiB query-text envelope therefore forced a
large current run into many sequential YDB reads even though each response remained far below the
existing 512 KiB payload-memory envelope.

The bounded correction keeps exact payload/metadata equality and the existing 512 KiB response
envelope, but replaces per-id OR predicates in both recovery and application resume with constant-size
primary-key range reads over canonical `source_record_revisions(source_record_id, revision)`.
Expected source IDs are sorted and split only by estimated response bytes. The query retains exact
`revision=1` and `migration_run_id` predicates; unexpected, missing, duplicate or mismatched
evidence remains fail-closed. No timeout, memory, cap, financial semantics, cleanup or write
authority is widened. The successor remains diagnostic-only until a fresh full recovery returns
enum-only staging evidence.

### Exact revision duplicate after PK-range optimization on `af5ed0a6a59da899b933920138efebbce2a855e7`

Full read-only recovery `35353769622` completed successfully after #625 and removed the previous
recovery timeout. Its enum-only evidence was:

- `COMPLETE_CURRENT_RUN_ONLY`;
- durable `COMPLETE_CURRENT_RUN_ONLY`;
- `STALE_STAGING_CURRENT_STATE_EMPTY`;
- source decode `NONE`;
- `EXACT_CURRENT_RUN_REVISION_DUPLICATE`.

No write-capable workflow ran. The duplicate appeared only in the new exact payload range path while
the metadata-only durable scan remained complete and internally consistent.

The bounded root-cause correction removes the client assumption that lexicographic Node string order
for UUID text is the same ordering YDB uses for `Uuid` range predicates. The metadata-only current-run
read now uses `ORDER BY source_record_id`; raw-payload range batches preserve exactly that
provider-returned order in both recovery diagnostics and application resume. Exact payload/metadata
equality, missing/extra/duplicate checks, the 512 KiB response-memory envelope and all write/authority
boundaries remain unchanged.

The successor remains diagnostic-only until a fresh full recovery returns enum-only exact revision
evidence.

### Fresh claim manifest read failure on `d47fcdb0a4f1f428b31cb798d9c53a3deed82545`

Exact-main recovery `35354805304` completed after #627 and still classified the previous run as stale
against the authoritative snapshot. Bounded orchestrator `35359627971` then armed only guarded stale
retirement, obtained fresh `READINESS_READY` from child `35359776773`, and dispatched exactly one
bootstrap child `35359914772`. The bootstrap entered the fresh metadata claim and returned the
privacy-safe signature:

`INITIAL_BOOTSTRAP_RUNTIME_FAILED / REFERENCE_APPLICATION_METADATA_FAILED / FRESH_CLAIM_WRITE / METADATA_EXECUTOR_IDENTITY_MANIFEST_READ_FAILED`.

Mandatory post-invoke read-only recovery returned `RECOVERY_REQUIRED / STALE_STAGING_RETIRED`. No
verified `COMMITTED` baseline exists, and same-SHA replay remains prohibited. Snapshot and
`migration_runs` direct readbacks had already succeeded inside the fresh serializable transaction;
the failing seam was the subsequent identity-manifest readback query, which redundantly rejoined
those already verified rows.

The bounded correction keeps recovery/resume's joined durable-context query unchanged but gives
fresh claim a separate primary-key manifest-content read. Fresh claim still exact-readback verifies
`source_snapshots`, `migration_runs`, manifest content and final admission evidence inside the same
serializable transaction; it simply does not repeat the already-proven snapshot/run context through
a provider JOIN. Write set/order, optimistic guards, retries, timeout/memory/caps, IAM, financial
semantics and authority are unchanged.

### Readiness Driver lifecycle deadline on `98766ddb30dc4444f763d8b53d5ed6858aa88e20`

After #628 merged, canonical CI/Browser/CodeQL passed and autocontinue dispatched orchestrator
`35366479481`. Initial read-only recovery admitted the bounded path, but fresh readiness child
`35366608053` stopped before any bootstrap child with privacy-safe evidence
`READINESS_INVOKE_NONZERO_UNCLASSIFIED / STDOUT_EMPTY__STDERR_TEXT / DEADLINE`. The orchestrator
published `STOP / R1_BOOTSTRAP_ORCHESTRATOR_READINESS_BLOCKED`, `bootstrapRunId=null`; therefore the
new fresh-claim manifest path has not yet been provider-exercised and same-SHA replay remains
forbidden.

Pinned `@ydbjs/core@6.3.1` gives `Driver.ready(signal?: AbortSignal)` its own default 30s ready timeout,
while PrihRash readiness has a 20s application deadline. The application deadline uses `Promise.race`:
if YDB client creation is still inside `Driver.ready()`, the outer deadline can reject without owning
the not-yet-returned client, so it cannot close that Driver. A surviving gRPC/event-loop lifecycle can
then outlive the structured application failure until the 45s Function deadline; the one bounded
read-only invoker retry makes the observed terminal transport deadline correspondingly longer.

The successor bounds only readiness YDB client startup with a 10s AbortSignal passed to
`Driver.ready()` and closes the Driver on failed startup. Ordinary scheduled sync/bootstrap clients
keep their existing ready budget because `readyTimeoutMs` is opt-in. Read/write transaction semantics,
Google/YDB authority, IAM, provider caps and the single write-capable child contract are unchanged.

## Incident-M provider attempt contract

Заголовок `R1 #453:*` сам по себе не разрешает provider invoke. Merged PR обязан содержать ровно
по одной строке `Provider-Attempt`, `Observed-Signature`, `Expected-Transition`, `Recovery-State`,
`Circuit-Rearm` и `Regression-Test` по contract из `AGENTS.md`. Autocontinue дополнительно проверяет,
что exact regression test действительно изменён вместе с runtime/script/R1-workflow surface, а
`Observed-Signature` совпадает с deterministic signature из последнего relevant completed
privacy-safe orchestrator/bootstrap evidence. Missing/ambiguous/mismatched evidence fail-closed до
dispatch. Cross-run history считает только distinct-SHA root-cause attempts с доказанно достигнутым
bootstrap invoke; если одна safe signature пережила две такие попытки, autocontinue завершает
`BLOCKED_NEEDS_ROOT_CAUSE` и не запускает provider workflow. Diagnostic-only PR, повтор уже
использованного SHA или неограниченный changeset также не dispatch-ит orchestrator.

Standalone `R1 Yandex readiness`, `R1 initial shadow bootstrap` и `R1 initial bootstrap recovery` сохраняются как reviewed stage-specific primitives / diagnostic fallback, но пока #453 активен нормальный Owner path — orchestrator. Никакие child workflows не должны запускаться владельцем между шагами orchestrator run.

Workflows **не создают** IAM roles, service accounts, secrets, Function, triggers или timers. Provider resources и least-privilege bindings создаются Owner/provider-admin отдельно и только после quality gate #433.

## Жёсткая граница #433

До закрытия #433 запрещены setup/deploy/invoke write-capable provider resources этого gate.

Write-capable bootstrap child дополнительно проверяет перед OIDC exchange:

- Issue #433 имеет `state=closed`;
- GitHub сообщает `main.protected=true`;
- current `main` указывает на exact `GITHUB_SHA` workflow run;
- для exact `GITHUB_SHA` существует successful `R1 Yandex readiness`, запущенный через `workflow_dispatch` из `main`.

Orchestrator dispatch-ит readiness именно через `workflow_dispatch`, ждёт его terminal success и отдельно проверяет enum-only `READINESS_READY` artifact. Перед запуском bootstrap child orchestrator ещё раз читает current `main`. Сам bootstrap child повторяет exact-main check перед `function version create` и перед bootstrap invoke.

Это означает, что repository-side workflow можно review/merge заранее, но current незакрытый #433 структурно блокирует live write-capable provider boundary.

## Dedicated provider resources

Имена:

- Function: `prihrash-r1-initial-bootstrap`;
- runtime service account: `prihrash-initial-bootstrap`;
- Lockbox secret: `prihrash-r1-initial-bootstrap`;
- GitHub deployment service account: `prihrash-github-initial-bootstrap`;
- Function tag: `r1-initial-bootstrap`;
- read-only recovery tag: `r1-initial-bootstrap-recovery`.

Function должна быть:

- private;
- triggers = 0;
- logging disabled;
- runtime `nodejs22`;
- write-capable bootstrap memory `1g`;
- read-only recovery memory `1g`;
- write-capable bootstrap version: execution timeout `600s`;
- read-only recovery version: execution timeout `150s`;
- write-capable entrypoint `index.initialBootstrapHandler` только в bootstrap version;
- read-only entrypoint `index.initialBootstrapRecoveryHandler` только в recovery version.

Не создавать trigger даже временно. Timer остаётся выключен.

## Runtime service account

`prihrash-initial-bootstrap` получает только временную authority, необходимую initial shadow bootstrap:

- `ydb.editor` только на target YDB database;
- `lockbox.payloadViewer` только на dedicated secret `prihrash-r1-initial-bootstrap`;
- `kms.keys.encrypterDecrypter` только на exact customer-managed KMS key, **если** этот secret действительно использует такой key.

Не назначать `ydb.editor` на folder/cloud. Не расширять существующий readiness runtime account.

После successful bootstrap эти права являются временными и подлежат retirement.

## Deployment identity / WIF

`prihrash-github-initial-bootstrap` не получает YDB write и не читает Lockbox payload.

Минимальная цель IAM:

- временный `functions.auditor` только на target PrihRash folder — исключительно для read-only `yc serverless trigger list`, который независимо доказывает `triggers=0` до и после deploy; роль не даёт управления triggers и снимается после successful bootstrap;
- `functions.editor` только на `prihrash-r1-initial-bootstrap` Function;
- `functions.functionInvoker` только на эту Function;
- `iam.serviceAccounts.user` только на exact runtime SA `prihrash-initial-bootstrap`, необходимый deployment WIF для attachment этого SA к Function version;
- WU7 использует обычный synchronous Function invocation от deployment WIF и не требует `asyncInvocationConfig`. Уже выданные exact-Function `functions.functionInvoker` / `functions.viewer` для runtime SA не являются WU7 prerequisites и сохраняются только до отдельного least-privilege retirement decision; см. `docs/R1_INITIAL_CONTROLLED_REBUILD_RUNBOOK.md`.
- `lockbox.viewer` только на dedicated bootstrap secret для lookup metadata/current version.

Folder-scoped `functions.auditor` — единственное намеренное расширение metadata visibility за пределы dedicated Function: Yandex Cloud trigger-list API перечисляет triggers на уровне folder, а workflow fail-closed фильтрует этот список по exact Function ID. Уже существующий exact-Function `functions.viewer` для runtime SA не расширять на folder/cloud и не использовать как основание для нового IAM widening. Не поднимать `functions.viewer`, `functions.editor`, primitive `viewer`/`auditor` или более широкую authority на folder/cloud.

WIF credential/binding должен принимать только canonical GitHub identity:

- issuer `https://token.actions.githubusercontent.com`;
- audience `https://github.com/kmephis-ai`;
- subject `repo:kmephis-ai@310519475/PrihRash@1359286840:ref:refs/heads/main`.

Никаких long-lived Yandex keys в GitHub.

## GitHub locators

Repository Actions secrets:

```text
YC_R1_FOLDER_ID
YC_R1_INITIAL_BOOTSTRAP_WIF_SERVICE_ACCOUNT_ID
YC_R1_INITIAL_BOOTSTRAP_LOCKBOX_SECRET_ID
```

`YC_R1_INITIAL_BOOTSTRAP_LOCKBOX_SECRET_ID` — только resource locator, не payload и не credential. Workflow получает secret через exact ID и сверяет returned name/folder before use.

## Dedicated Lockbox payload

Secret `prihrash-r1-initial-bootstrap` содержит только runtime values:

```text
google_spreadsheet_id
google_service_account_email
google_service_account_private_key
ydb_connection_string
initial_bootstrap_private_historical_evidence
```

Последний key содержит private, Owner-verified historical granularity/month evidence для initial bootstrap. Реальные ordinal ranges/month mapping не публикуются в GitHub, Issues, PR, Actions logs или fixtures.

Write-capable bootstrap Function получает server-side bindings:

- `PRIHRASH_GOOGLE_SPREADSHEET_ID` ← `google_spreadsheet_id`;
- `PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL` ← `google_service_account_email`;
- `PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` ← `google_service_account_private_key`;
- `PRIHRASH_YDB_CONNECTION_STRING` ← `ydb_connection_string`;
- `PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE` ← `initial_bootstrap_private_historical_evidence`.

Recovery-only version получает Google readonly credentials + `ydb_connection_string` + `initial_bootstrap_private_historical_evidence`. Private historical evidence используется только внутри fail-closed stale-`VALIDATED` read-only reconstruction/`NOT_APPLIED` proof и не добавляет recovery package write authority.

Private historical evidence parser fail-closed проверяет exact schema, range coverage и совместимость с фактическим количеством leased source rows.

## Deployment artifacts

Write-capable canonical command:

```text
npm run package:initial-bootstrap
```

Artifact:

```text
.artifacts/yandex-initial-bootstrap-function
```

Root shim экспортирует только:

```text
index.initialBootstrapHandler
```

Read-only recovery artifact orchestrator собирает через:

```text
npm run package:initial-bootstrap-recovery
```

Verifier-ы требуют разделённые runtime surfaces: bootstrap package не включает scheduled/readiness/schema entrypoints, а recovery package запрещает write-capable statements/transactions и write-capable bootstrap Function entrypoint.

## Fresh readiness перед live bootstrap

Owner больше не должен вручную переносить состояние между recovery/readiness/bootstrap.

После merge final #453 source в `main`, закрытого #433 и provider setup:

1. убедиться, что canonical `main` содержит нужный source и CI green;
2. вручную запустить **только** `R1 initial bootstrap orchestrator` из `main`;
3. не запускать параллельно standalone readiness/bootstrap/recovery workflows;
4. orchestrator сам выполнит read-only durable classification, fresh exact-main readiness и максимум один bootstrap child;
5. если `main` изменится на любой критической границе, текущий run fail-closed остановится; для нового SHA нужен новый manual orchestrator run.

Один dispatch orchestrator = максимум одна новая write-capable bootstrap attempt. Ручной запуск child bootstrap внутри того же цикла запрещён.

## Что делает runtime

Dedicated Function:

1. читает immutable authoritative Google snapshot через existing canonical Google reader;
2. использует canonical row/snapshot digest;
3. применяет private historical granularity evidence fail-closed;
4. читает current YDB reference resolver evidence;
5. создаёт runtime UUID/clock values;
6. запускает canonical initial-bootstrap application lifecycle;
7. pre-promotion reconciliation строится из persisted revision evidence, а не self-comparison candidate;
8. promotion выполняется только после canonical validation;
9. если result `COMMITTED`, runtime выполняет **независимый physical current-state read-back**;
10. Function возвращает PASS только если post-COMMITTED reconciliation имеет все canonical checks `MATCHED` и zero unexplained high-impact mismatch.

Unknown/ambiguous/recovery state не превращается в success.

## Sanitized invocation contract

Canonical invocation:

```text
npm run initial-bootstrap:invoke
```

Invoker вызывает только exact Function ID + tag `r1-initial-bootstrap`, `--retry 0`, и не передаёт private repository/runtime env в child `yc` process.

Единственный successful exit:

```json
{"status":"PASS","code":"INITIAL_BOOTSTRAP_COMMITTED"}
```

Это означает: application завершил `COMMITTED` **и** independent post-COMMITTED read-back полностью совпал с canonical expected evidence.

Безопасные non-success outcomes:

```text
NOOP / INITIAL_BOOTSTRAP_BASELINE_EXISTS
STOP / INITIAL_BOOTSTRAP_VALIDATION_BLOCKED
STOP / INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED
STOP / INITIAL_BOOTSTRAP_RECOVERY_REQUIRED
FAIL / INITIAL_BOOTSTRAP_CONFIG_INVALID
FAIL / INITIAL_BOOTSTRAP_RECONCILIATION_FAILED
FAIL / INITIAL_BOOTSTRAP_RESULT_INVALID
FAIL / INITIAL_BOOTSTRAP_RUNTIME_FAILED
FAIL / INITIAL_BOOTSTRAP_INVOKER_CONFIG_INVALID
FAIL / INITIAL_BOOTSTRAP_INVOKE_FAILED
FAIL / INITIAL_BOOTSTRAP_INVOKE_FUNCTION_TIMEOUT
FAIL / INITIAL_BOOTSTRAP_INVOKE_NONZERO_UNCLASSIFIED
FAIL / INITIAL_BOOTSTRAP_INVOKE_OUTPUT_INVALID
```

При numeric non-zero transport exit invoker сначала пытается строго распознать exact allowlisted **non-PASS** Function result из captured stdout; provider/private detail не публикуется. `PASS / INITIAL_BOOTSTRAP_COMMITTED` при transport non-zero не принимается как success и остаётся fail-closed.

`INITIAL_BOOTSTRAP_INVOKE_FUNCTION_TIMEOUT` означает только exact privacy-safe classification provider envelope `Function execution timeout (504)`. `INITIAL_BOOTSTRAP_INVOKE_NONZERO_UNCLASSIFIED` означает numeric non-zero provider exit без доказанного allowlisted non-success result/marker. Оба кода являются non-success diagnostic evidence и сами по себе **не** разрешают retry/replay bootstrap.

После bootstrap #59 (`35260379450`) exact provider evidence доказал HTTP 504 практически на 300-секундной границе ранее configured Function timeout. Поэтому initial-bootstrap Function использует bounded execution timeout `600s`, а HTTPS invoker — `630s`: provider deadline остаётся раньше client transport deadline. Это исправление только доказанного execution-envelope blocker; retries, atomic cap, write predicates и authority не расширяются.

Последующее read-only recovery evidence orchestrator #54 / bootstrap #59 сузило causal layer: до invoke старый STAGING имел `COMPLETE_CURRENT_RUN_ONLY` при authoritative snapshot mismatch, а после non-success invoke durable evidence стало `PARTIAL_CURRENT_RUN_ONLY`. Это доказывает, что guarded stale-STAGING path был пройден и fresh run успел materialize часть нового revision evidence; активный bottleneck находится в fresh revision-evidence persistence, а не в stale retirement. Поэтому exact initial revision INSERT batching использует один typed `List<Struct>` parameter через `AS_TABLE($rows)` и делится только по уже calibrated `PRELIVE_PROMOTION_PARAMETER_BYTES_LIMIT=512 KiB`. Отдельный 50-row cap удалён как недоказанный provider limit; сам 512 KiB cap, transaction isolation, append-only `INSERT`, resume semantics, retries, write predicates и authority не расширяются. Revision-evidence preflight больше не строит placeholder query пачками по 300 keys: сначала выполняется один exact run-scoped read, затем все ещё отсутствующие expected `source_record_id` проверяются одним typed `List<Struct>` parameter через `AS_TABLE($source_keys)`. Это сохраняет fail-closed detection extra/duplicate/mismatched revision-1 evidence и убирает последовательные provider round-trips из fresh/resume preparation.

Live orchestrator `35305575877` на exact `b278522948cd286f1d455c810291719890c84c8e` доказал новую границу: fresh readiness завершился `READINESS_READY`, единственный bootstrap child достиг invoke и остановился privacy-safe как `INITIAL_BOOTSTRAP_INVOKE_FAILED`, после чего встроенная read-only recovery достигла собственного execution envelope и вернула `INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILED`. One-shot write authority на этом SHA считается consumed; никакой replay этим evidence не разрешён. Для восстановления диагностической наблюдаемости staging revision diagnostic больше не читает manifest bindings placeholder-пачками по 50 keys: после manifest read выполняется один exact run-scoped revision read и максимум один typed `List<Struct>` / `AS_TABLE($source_keys)` collision read. Это read-only performance correction, не расширение provider/write authority.

Следующий authorized resume orchestrator `35311546126` на exact
`13c2dea8ee7a7ad63f89570aa5f65bf0ec2511fd` повторно доказал до invoke
`STAGING_RUN_PRESENT / COMPLETE_CURRENT_RUN_ONLY / STALE_STAGING_CURRENT_STATE_EMPTY` и
`READINESS_READY`, но единственный bootstrap child `35311729347` завершился новой safe
provider signature `INITIAL_BOOTSTRAP_INVOKE_HTTP_FAILED / HTTP_502 / PRESENT`. Post-invoke
read-only recovery снова доказал тот же complete resumable STAGING без verified current writes.
Поскольку raw HTTPS invocation при нормальном handler return должна завершаться HTTP 200, а package
wrapper уже sanitizes module-load/handler exceptions, этот evidence локализует следующий риск в
process/runtime-level failure до `VALIDATION_TRANSITION_WRITE`. Resume path поэтому освобождает
no-longer-needed Google lease, projected reference rows и reference plan сразу после доказанного
zero-reference-write gate и до application resume. Это memory-lifetime correction: financial
semantics, write set, caps, retries и provider authority не меняются.


`VALIDATION_BLOCKED` может вернуть только allowlisted blocker taxonomy и optional allowlisted reconciliation check. `RECOVERY_REQUIRED` возвращает только allowlisted recovery reason. Run IDs, source IDs, row counts, amounts, raw payload, descriptions, provider exception text и credentials наружу не возвращаются.

`BASELINE_EXISTS` — безопасный NOOP, но **не** доказательство, что этот workflow выполнил первый bootstrap; invoker завершает его non-zero.

`CONTROLLED_REBUILD_REQUIRED` запрещает auto-rebuild и автоматическое повышение cap.

## Read-only recovery classification contract

Orchestrator до любой новой write attempt разворачивает exact-main recovery-only Function version под tag `r1-initial-bootstrap-recovery` и вызывает её один раз. Этот путь всегда начинает с read-only durable YDB classification и не имеет write-capable runtime path. Standalone `R1 initial bootstrap recovery` остаётся diagnostic fallback, но нормальный Owner path не зависит от hardcoded failed-run rebinding.

Если durable classification точно равна `RESIDUAL_REFERENCE_STATE_WITHOUT_RUN`, тот же recovery invocation выполняет один fresh authoritative Google read через canonical `Ответы на форму (11)` A:K reader и Google readonly scope. Для stale `VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY` recovery после exact `AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH` Function дополнительно получает existing private historical bootstrap evidence из того же dedicated Lockbox и использует его только для read-only historical candidate/staging/`NOT_APPLIED` proof. Другие drift classes не повышаются до достаточного historical proof.

После live run `35518900387` на exact `main=54740d9ff0acdd3b3e010be1e1eafe4b679c06bf` historical recovery впервые дошёл до полного reconstruction path, но read-only invoke завершился bounded `INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILED` до выдачи Gate A enum. Все deploy/IAM/private-trigger-free gates перед invoke прошли. Поэтому recovery Function получает тот же stage-specific CPU/memory envelope, уже используемый тяжёлыми controlled diagnostics: memory `1g`, execution timeout остаётся `150s`; sanitized invoker остаётся `180s`. Это performance-envelope correction, а не увеличение migration cap/write authority: YDB/Google mutation semantics, IAM и timeout не меняются.

Fresh exact-main recovery [35519549022](https://github.com/kmephis-ai/PrihRash/actions/runs/35519549022) на `eedfa45dae4b75b1f2c8bbe71d9648080e58d662` после memory-envelope correction завершился PASS-классификацией `RECOVERY_REQUIRED / VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY`, source evidence `AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH` и Gate A blocker `IN_FLIGHT_PROVIDER_MUTATION_UNKNOWN`. Это live-доказательство, что historical candidate reconstruction и exact staging/`NOT_APPLIED` discrimination уже проходят; незакрытым остаётся отдельный provider-completion predicate из Gate A, а не historical-context layer.

Reference reconciliation сравнивает derived authoritative bootstrap vocabulary с полным durable `accounts/categories/family_members` state: exact account/category identity keys, canonical account semantics, RUB/status/display/source labels, пустые bootstrap-only category hierarchy fields и единственного ACTIVE member `Вика`. IDs проверяются только как opaque valid UUID и наружу не публикуются. Missing/extra/duplicate/malformed/drifted row даёт `RESIDUAL_REFERENCE_STATE_MISMATCH`; exact equality даёт `RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE`; source/provider/read instability даёт `REFERENCE_RECONCILIATION_FAILED`. Все три результата сохраняют verdict `RECOVERY_REQUIRED` и сами по себе **не** разрешают replay, cleanup или rebuild.

До и после detailed reference read runtime повторно подтверждает, что durable surface всё ещё классифицируется как `RESIDUAL_REFERENCE_STATE_WITHOUT_RUN`; изменение слоя во время reconciliation fail-closed превращается в `REFERENCE_RECONCILIATION_FAILED`. Recovery выполняет только provider READ operations; `serializableReadWrite` и write statements запрещены package verifier-ом.

Successful recovery classification публикует только exact sanitized shape `status/code/verdict/reason`, где `verdict` принадлежит `APPLIED | NOT_APPLIED | RECOVERY_REQUIRED`, а `reason` — allowlisted enum, согласованный с verdict. Row counts, IDs, account/category labels, amounts, descriptions, raw Google/YDB rows, snapshot digests и exception text в result/log evidence не публикуются. `READ_FAILED`, `REFERENCE_RECONCILIATION_FAILED` и любая неизвестная/несогласованная форма остаются fail-closed и не разрешают replay.

### Bounded orchestrator decision

После initial read-only classification orchestrator может войти в fresh readiness/bootstrap path только в двух случаях:

- `NOT_APPLIED / EMPTY_DURABLE_STATE` — durable writes предыдущей попытки не обнаружены;
- `RECOVERY_REQUIRED / RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE` — durable reference-only residue доказано совпадает с fresh authoritative-derived vocabulary, **но** окончательное разрешение application path остаётся внутри same-fresh-snapshot reference-aware bootstrap guard.

`APPLIED / COMMITTED_DURABLE_STATE`, mismatch, mixed/metadata/current-lineage residue, failed/staging/validated run, read instability и любые другие причины не запускают новый bootstrap автоматически.

Если единственный bootstrap child в текущем orchestrator run достиг invoke и завершился non-success/unknown, orchestrator вызывает уже развёрнутый read-only recovery tag ещё ровно один раз, фиксирует sanitized classification и завершает run. Эта post-invoke classification не инициирует второй bootstrap в том же run.

Этот diagnostic/orchestration surface временный для #453; после снятия recovery ambiguity и successful bootstrap он подлежит retirement, а не превращению в постоянный migration scheduler.

## Failure / retry policy

Не делать blind retry.

- Один manual dispatch `R1 initial bootstrap orchestrator` = максимум один write-capable bootstrap child и максимум один его invoke.
- Если bootstrap child остановился **до** шага `Invoke exact initial bootstrap tag once`, финансовый bootstrap invocation не начинался. Orchestrator не запускает recovery-after-write; после устранения причины новый manual orchestrator run снова начнётся с read-only durable classification и fresh readiness.
- Если invoke step начался и child завершился non-success/unknown, тот же orchestrator run выполняет одну read-only recovery classification и останавливается. Второй bootstrap в этом run структурно отсутствует.
- Новый orchestrator run после ambiguous write может продолжить путь только через fresh initial recovery gate. `RESIDUAL_REFERENCE_STATE_MATCHES_AUTHORITATIVE` не даёт replay permission само по себе: write-capable runtime повторно доказывает same-snapshot reference guard и zero planned reference writes до application path.
- `INITIAL_BOOTSTRAP_INVOKE_FUNCTION_TIMEOUT` и `INITIAL_BOOTSTRAP_INVOKE_NONZERO_UNCLASSIFIED` подтверждают только sanitized provider-envelope classification; они не доказывают отсутствие application writes и не являются разрешением на automatic retry/replay.
- Unknown provider/transport detail не интерпретировать как success или safe replay.
- Не выполнять controlled rebuild, cleanup или automatic cap increase.
- Не запускать standalone bootstrap вручную для обхода blocked orchestrator state.

## Privacy-safe evidence

Orchestrator публикует один short-lived `classification.json` artifact с фиксированным privacy-safe surface: orchestrator `status/code`, exact source SHA, child run IDs/conclusions, sanitized recovery verdict/reason и readiness code. Он не содержит financial rows/totals/amounts/descriptions/notes, raw Google/YDB snapshots, source IDs/digests, credentials, Lockbox payload или provider identifiers.

После PASS в Issue/PR можно фиксировать только:

- exact source SHA;
- orchestrator workflow run = success;
- readiness child workflow run = success и `READINESS_READY`;
- bootstrap child workflow run = success;
- sanitized bootstrap contract `INITIAL_BOOTSTRAP_COMMITTED`;
- факт independent post-COMMITTED reconciliation PASS;
- факт retirement temporary authority.

При non-success можно фиксировать только sanitized orchestrator/recovery/bootstrap enum evidence и run IDs, без provider exception payload или financial detail.

## Retirement после successful bootstrap

До timer/scheduled sync удалить usable temporary write path:

1. снять `ydb.editor` с `prihrash-initial-bootstrap` на target database;
2. снять dedicated `lockbox.payloadViewer`;
3. снять temporary folder-scoped `functions.auditor` с `prihrash-github-initial-bootstrap`;
4. снять exact KMS role, если он был нужен этому secret;
5. деактивировать dedicated Lockbox secret;
6. отвязать/delete dedicated WIF federated credential для `prihrash-github-initial-bootstrap`;
7. удалить GitHub locator `YC_R1_INITIAL_BOOTSTRAP_WIF_SERVICE_ACCOUNT_ID` после retirement соответствующей identity;
8. dedicated Function удалить либо оставить только как private trigger-free recovery scaffold без YDB write/secret payload authority;
9. после фиксации provider evidence удалить/отключить stage-specific `R1 initial bootstrap orchestrator` и больше не использовать direct bootstrap/recovery workflows как operational path.

Deployment service account можно оставить без usable WIF binding либо удалить позже отдельным cleanup. `YC_R1_INITIAL_BOOTSTRAP_LOCKBOX_SECRET_ID` сам по себе не credential; после деактивации secret его removal из GitHub — optional cleanup, не retirement gate.

Retirement — Owner/provider-admin boundary. Workflow намеренно не получает IAM-admin authority для self-revoke.

## Exit boundary #453

#453 может считаться provider-complete только когда доказаны все пункты:

```text
#433 closed + main protected + canonical CI PASS
→ exact current main
→ one manual R1 initial bootstrap orchestrator
→ read-only durable recovery gate
→ fresh READINESS_READY child on exact SHA
→ at most one private trigger-free bootstrap child/invoke
→ INITIAL_BOOTSTRAP_COMMITTED
→ independent post-COMMITTED reconciliation PASS
→ temporary bootstrap authority + stage-specific orchestration retired
```

При non-success после write boundary путь заканчивается `one read-only recovery classification → STOP`; automatic second bootstrap отсутствует.

### Preflight rebase из-за source drift после WU7 на `efe316b45edace5d0ffceabd47e3b8c3672edd1c`

Единственная controlled rebuild попытка WU7 `36238246863` прошла exact-main, fresh
recovery/readiness, private trigger-free и initial throttling checks. Она установила throttling
14 RU/s, выполнила ровно один controlled rebuild invoke и восстановила/независимо прочитала
10 RU/s. Bounded результат:

`FAIL / INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED / APPLICATION_FAILED / PREPARATION / RECONCILIATION_READ / QUERY_EXECUTION_FAILED`.

Phase probe недоступен: `INITIAL_CONTROLLED_REBUILD_PHASE_UNAVAILABLE / LOG_READ_FAILED`.
Второй financial invoke не выполнялся.

Post-invoke full read-only recovery `36238543493` вернул
`RECOVERY_REQUIRED / STAGING_RUN_PRESENT` и privacy-safe staging evidence:

- `AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH`;
- durable revision evidence — `COMPLETE_CURRENT_RUN_ONLY`;
- verified current — `STALE_STAGING_CURRENT_STATE_EMPTY`;
- source decode — `NONE`;
- exact current-run source proof — `EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN`.

На том же SHA orchestrator `36239021237` был запущен с обоими staging flags выключенными. Он
остановился до readiness/bootstrap с
`R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED / RECOVERY_REQUIRED / STAGING_RUN_PRESENT`;
`readinessRunId=null`, `bootstrapRunId=null`. Следовательно, текущее состояние не разрешает
resume, retirement или повтор WU7 на этом SHA.

Детерминированная pre-write orchestrator signature вместе со свежими digest-mismatch и
empty-current evidence допускают только существующее исключение source-drift rebase на новом exact
SHA:
`Recovery-State: STAGING_STALE_RETIREABLE` и `Circuit-Rearm: SOURCE_DRIFT_REBASE`. Canonical
autocontinue может запустить один orchestrator на exact main с
`allow_staging_resume=false` и `allow_stale_staging_retirement=true`; runtime всё равно обязан
повторно доказать cutoff/history и exact durable state до любого retirement или нового bootstrap.
Это evidence не разрешает WU7 replay, blind retry, cleanup неоднозначного состояния, увеличение
cap, timer или cutover.

### Full recovery после неуспешного source-drift rebase на `8a68969a4cc7e313e48b0147da84960a60166941`

Orchestrator `36239901216` на exact main после preflight выполнил свежий `READINESS_READY`
`36239981608` и ровно один bootstrap child `36240045946`. Child завершился
`INITIAL_BOOTSTRAP_INVOKE_FAILED` без классифицированного application phase. Обязательная
post-invoke recovery вернула только `RECOVERY_REQUIRED / STAGING_RUN_PRESENT`.

Её privacy-safe diagnostics совпали с preflight:

- `AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH`;
- durable revision evidence — `COMPLETE_CURRENT_RUN_ONLY`;
- verified current — `STALE_STAGING_CURRENT_STATE_EMPTY`;
- source decode — `NONE`;
- exact current-run source proof — `EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN`.

Этого недостаточно, чтобы классифицировать staging как resumable или разрешить ещё один retirement.
Следующий и единственный допустимый шаг — full read-only exact revision recovery на новом exact SHA
через `Provider-Attempt: NOT_AUTHORIZED`, `Recovery-Probe: READY`,
`Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION` и
`Recovery-State: STAGING_PRESENT_UNCLASSIFIED`. До её результата запрещены readiness/orchestrator/
bootstrap, resume, retirement и cleanup.

### Результат full exact-revision recovery на `d4e97538803664431f448f381020d60f622ba0bb`

Recovery `36240934391` завершилась PASS как workflow и вернула
`RECOVERY_REQUIRED / STAGING_RUN_PRESENT`. Exact revision diagnostics повторили:

- `AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH`;
- durable revision evidence — `COMPLETE_CURRENT_RUN_ONLY`;
- verified current — `STALE_STAGING_CURRENT_STATE_EMPTY`;
- source decode — `NONE`;
- exact current-run source proof — `EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN`.

Probe не доказал `AUTHORITATIVE_SOURCE_ADVANCED`, immutable cutoff validity или exact resumable
identity. Он не разрешает продолжить retirement/rebase или повтор bootstrap. Следующая provider
попытка остаётся disarmed до отдельного deterministic root-cause/evidence fix и новой допустимой
authority boundary; Google остаётся authoritative, YDB — shadow.

### Повтор RESOURCE_EXHAUSTED на paginated metadata scan на `c34bc8cda33b9cd58d7f0affad841aa577f73622`

Controlled-preparation-only recovery `36244255372` выполнила только read-only continuation diagnostic.
Reference snapshot прошёл; затем она воспроизвела:

- preparation `YDB_DATA_QUERY_EXECUTION_FAILED`;
- retry `RETRIED`, query error `GRPC_STATUS`, gRPC status `RESOURCE_EXHAUSTED`;
- phase `RECONCILIATION_READ`, substage `REVISION_METADATA_SCAN`;
- payload batch `UNOBSERVED`.

На этом SHA metadata reconciliation ещё выполняла отдельный запрос на каждую 128-row UUID page.
Это причинно связывает текущий отказ с burst RU, исчерпываемым последовательными page queries; exact
payload verification не начиналась. Full recovery на том же YDB ранее успешно получила полный
metadata-only run scan через один запрос к тому же exact index. Минимальный repository correction
возвращает для metadata proof один ordered index read только с metadata columns. Complete-set,
duplicate/extra/contradictory guards остаются включёнными; `raw_payload` по-прежнему читается
отдельно exact primary-key range batches в пределах 64 KiB.

Этот root-cause candidate остаётся diagnostic-only: после merge допускается только один fresh
controlled-preparation-only read-only probe на exact main. Ни WU7, ни bootstrap, ни resume/retirement
не вооружаются до `READY`, complete exact payload evidence и доказательства current cutoff; любая
повторная `RESOURCE_EXHAUSTED` требует нового sanitized stage evidence до выбора следующего fix.

### RESOURCE_EXHAUSTED переместился на payload batch на `7ea94aeaffb807564c6a220d926ed2723f82690f`

Controlled-preparation-only recovery `36246991989` после one-query metadata correction доказала, что
отказ переместился на следующий exact stage:

- reference snapshot — `REFERENCE_SNAPSHOT_VALIDATED`;
- phase — `RECONCILIATION_READ`;
- substage — `REVISION_PAYLOAD_BATCH`;
- gRPC status — `RESOURCE_EXHAUSTED`, retry — `RETRIED`.

При текущем throttling 10 RU/s единичный 64 KiB payload range может потребовать до 16 I/O RU, а
последовательные batch queries не учитывали восстановление RU budget. Следующая bounded correction
ограничивает batch по строкам и bytes и перед каждым exact payload query ждёт пропорционально
allowlisted оценке RU, включая запас на CPU. Raw-payload equality, полный набор source identities и
64 KiB upper response envelope не ослабляются. Только read-only controlled-preparation mode получает
600 s outer Function/invoker envelope, чтобы выполнить paced diagnostic; остальные recovery mode
сохраняют 150 s, а inner YDB deadlines остаются 10/21/25 s.

После merge разрешён ровно один fresh controlled-preparation-only read-only probe. Если он не
докажет `READY` + complete exact payload evidence, provider writer остаётся disarmed до следующей
причинной диагностики. Даже `READY` сам по себе не снимает requirement свежих exact cutoff/recovery,
readiness и новой open one-shot authority перед WU7.

### Outer deadline read-only paced diagnostic на `51834f052334e103e5dc3d602f4152aff8d6c447`

Recovery `36250109918` на exact main с `controlled_preparation_only=true` завершилась failure после
исчерпания нового 600 s read-only diagnostic envelope; enum artifact не был создан. Этот путь не
содержит lifecycle/data/scheme/current writes, поэтому durable YDB не менялся. Результат не считается
`READY`, не является разрешением resume и не вооружает WU7.

Последняя причина таймаута — pacing использовал 8 RU/s при provider baseline 10 RU/s. Successor
оставляет все YDB resource settings на 10 RU/s, но повышает только локальную pacing target до
10 RU/s, сохраняя 2 RU/query safety margin и лимит восьми строк на payload batch. Это не меняет
provider cap или RU allowance. Следующий и единственный допустимый probe — fresh
controlled-preparation-only read-only run с bounded 600 s; после timeout/non-PASS новых diagnostic
или write invocations по тому же SHA нет.

### Следующий pacing candidate на `51834f052334e103e5dc3d602f4152aff8d6c447`

Repository successor сохраняет byte envelope 64 KiB и row batch ≤9, target pacing остаётся на
подтверждённых 10 RU/s, CPU margin — 1 RU. Для batch из 9 rows это оставляет 1 s перед следующим
query; большие payload ranges ждут пропорционально оценке RU. Cap,
provisioned RCU, IAM и writer authority не меняются.

После merge этот successor может выполнить только один controlled-preparation-only read-only probe
на exact main в bounded 600 s envelope. Если он снова завершится timeout или не докажет `READY` и
полную exact payload equality, diagnostic stops; WU7 остаётся disarmed до новой причинной гипотезы.

### Идемпотентный RU deadline после timeout `36257149785`

Свежий controlled-preparation-only recovery на exact main
`c740df689709ebdb2f281a9bafe53903e4ad7870` завершился по 600 s envelope без enum artifact; write
path не запускался. Repository timing review нашёл лишний idle time в pacing: перед каждым batch
полностью ждалась оценка `RU / 10` уже **после** завершения предыдущего query, то есть время самого
query не засчитывалось в refill интервал.

Successor сохраняет предел 10 RU/s, 1 RU CPU margin и batch ≤9 rows; pacer теперь удерживает
monotonic next-request deadline и ждёт только остаток интервала от старта предыдущего YDB request.
Это не уменьшает refill delay и не увеличивает cap, а убирает двойной учёт elapsed query time. Следующий
шаг после merge — один новый 600 s controlled-preparation-only read-only probe; никаких writer actions
эта проверка не вооружает.

### RESOURCE_EXHAUSTED во время исторической reconstruction на `07d5a604307ea7809534b65d7d3625a9531aa936`

Read-only controlled-preparation recovery `36262391812` после metadata/payload pacing candidate
классифицировала:

- `APPLICATION_BOOTSTRAP_OBSERVATION_INVALID`;
- phase `RESUME_CONTEXT_READ`;
- query failure `YDB_DATA_QUERY_EXECUTION_FAILED / GRPC_STATUS / RESOURCE_EXHAUSTED`;
- reconciliation stage `UNOBSERVED`.

Repository trace локализовал boundary в stale-cutoff reconstruction: весь run-scoped `raw_payload`
читался одним YDB result до controlled continuation и его byte-bounded verifier. Это отдельный
causal seam, не тот же payload-batch RESOURCE_EXHAUSTED. Successor сначала выполняет один
metadata-only exact-index scan, затем читает payload в paced primary-key ranges. Каждая payload row
сверяется с immutable manifest, `observed_at`, row digest и canonical payload digest; полный набор
должен совпасть exact.

Успешная reconstruction выдаёт in-memory branded proof, связанный с run, snapshot и точными
revision bindings. Application и durable reconciliation валидируют proof против полученного lineage
и не повторяют ту же дорогостоящую exact revision read; forged/mismatched proof остаётся fail-closed.
Proof не сериализуется и не содержит raw payload. Если его проверка не проходит, обычный exact
revision verifier остаётся fail-closed.

После merge допускается ровно один fresh controlled-preparation-only read-only probe. Успех требует
полной bounded reconstruction и `READY`; timeout/non-PASS не разрешает controlled rebuild, replay,
retirement, cleanup или authority change.

### Повторяемый RESUME_CONTEXT_READ read failure на `07d5a604307ea7809534b65d7d3625a9531aa936`

Recovery `36261520615` завершилась после bounded 600 s без enum artifact. Последующая controlled
preparation-only read-only классификация `36262391812` на том же SHA локализовала причину:

- `APPLICATION_BOOTSTRAP_OBSERVATION_INVALID`;
- phase `RESUME_CONTEXT_READ`;
- YDB `QUERY_EXECUTION_FAILED / GRPC_STATUS / RESOURCE_EXHAUSTED`;
- application-level revision reconciliation ещё `UNOBSERVED`.

Durable state не менялся: обе функции только читали Google/YDB. Причина — прежняя
`reconstructInitialBootstrapDurableObservation` читала все historical `raw_payload` одним YDB result
до application resume; предыдущие metadata/payload pagers этот boundary не затрагивали. Новый fix
делит историю на один exact metadata index scan и paced exact primary-key payload ranges. В памяти
остаётся только уже проверенный `InitialBootstrapDurableRevisionEvidenceProof`, жёстко привязанный к
run, snapshot, captured_at и каждому source id/rowHint/digest. Тот же in-memory proof позволяет
controlled continuation не повторять второй exact revision scan, но application/durable reconciliation
перед использованием повторно сверяют каждый lineage payload hash; forged/mismatched proof
fail-closes. Persisted schema, lifecycle и writer authority не меняются.

После merge допускается только один новый exact-main controlled-preparation-only recovery. Timeout
или иной non-PASS требует новой repo-side causal diagnosis; writer не запускается.

После provider-complete Google всё ещё authoritative, timer всё ещё выключен, YDB остаётся shadow. Следующая крупная runtime/authority boundary требует отдельного rolling-wave decision; этот runbook её не разрешает.

### Exact-key historical revision reads после recovery `36272896579`

На exact main `e2a41d415635e757c17f4194dd083a43117a7c37` controlled-preparation-only read-only recovery
`36272896579` прошла exact-main/provider preflight и recovery-only deployment, затем закончилась
`INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILED` на единственном recovery invoke. Enum artifact отсутствует;
этот результат **не** доказывает application phase, YDB status или изменение durable state. Workflow
не запускал bootstrap/write path.

Разбор кода показал, что historical payload batches выбирались широким primary-key диапазоном от
первого до последнего source id в batch. Source IDs разрежены; такой диапазон мог читать посторонние
revision rows между exact targets. Successor использует ограниченный список scalar equality-предикатов
по exact source ids вместе с exact `migration_run_id + revision`, сохраняя batch ≤9 и RU pacing.
Каждый ответ по-прежнему обязан точно совпасть по cardinality, identity, immutable metadata, canonical
payload digest и reconstructed source digest; mismatch остаётся fail-closed. Synthetic large fixture
проверяет один metadata scan, exact-key batches, полное покрытие и pacing без provider payload.

После merge разрешён ровно один новый exact-main controlled-preparation-only read-only probe. Любой
timeout/non-PASS требует новой repo-side причинной диагностики; controlled rebuild, bootstrap replay,
retirement и cleanup остаются disarmed.

### Диагностика грубой cardinality STAGING revisions после `36275268952`

Recovery `36275268952` на exact main `d5df31f54411359f55c67740b74baf97eb3d7086` после exact-key
candidate снова завершилась `INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILED` на единственном bounded
read-only invoke; enum artifact отсутствует. Broad range amplification больше не объясняет задержку,
но размер самой immutable STAGING manifest пока не измерен.

Repository successor добавляет отдельный режим `staging_revision_cardinality_only`. Он сначала
проверяет durable surface, затем выполняет один metadata-only join с единственным STAGING manifest
и выдаёт только `LT_3000_ROWS`, `GE_3000_LT_5000_ROWS`, `GE_5000_ROWS` или `DIAGNOSTIC_FAILED`.
Он не читает Google, revision payloads, source identifiers и не изменяет YDB. Перед выдачей bucket
должны совпасть manifest `rows_seen`, `binding_count` и snapshot `row_count`; неоднозначные или
несогласованные данные дают только `DIAGNOSTIC_FAILED`.

После merge разрешена ровно одна свежая exact-main read-only диагностика cardinality. Результат
служит только для выбора следующей repository-гипотезы: он не разрешает controlled preparation,
WU7, retirement, cleanup, изменение quota или write path.

### Однопроходное восстановление revisions после `GE_5000_ROWS`

Read-only cardinality diagnostic `36279266156` на exact main
`695598ec94e744ecf40dc5f889f862fb45db4aa2` вернул только `GE_5000_ROWS`. Точная длина источника
не публиковалась. Такая coarse-классификация согласуется с тем, что полный metadata scan, а затем
второй проход payload point-reads могут не уложиться в 600 s при текущем 10 RU/s budget.

Repository successor оставляет один run/revision secondary-index scan, но читает его keyset pages:
каждая страница возвращает metadata и raw payload одновременно, не более 9 rows, в provider order.
Manifest остаётся точным expected source-ID set. Невалидная/неполная страница, отсутствующий
manifest binding, лишний или повторный revision, metadata mismatch либо canonical digest mismatch
прерывает reconstruction fail-closed; дополнительного metadata-only row pass нет.

После merge допустим ровно один свежий exact-main controlled-preparation-only read-only probe.
`READY` требует полного восстановления и существующих application gates. Timeout/non-PASS означает
новую repo-side диагностику; controlled rebuild/WU7, bootstrap replay и cleanup не armed этим probe.

### Один проход по historical revisions после bucket `GE_5000_ROWS`

Cardinality-only recovery `36279266156` на exact main
`695598ec94e744ecf40dc5f889f862fb45db4aa2` вернула только `GE_5000_ROWS`. Это подтверждает, что
immutable STAGING manifest относится к верхней coarse-size группе; точное количество не публиковалось.

Root cause review показал повторное чтение каждого revision: полный metadata-only index scan, затем
отдельные exact-key payload batches. Successor убирает первый проход и использует keyset pagination
по существующему `idx_source_record_revisions_run_revision`, возвращая в каждом paced page metadata и
raw payload вместе, не более 9 строк на страницу. Каждый revision проверяется против exact
manifest binding, run/revision, timestamp, row digest и canonical payload digest. Чтение продолжается
до исчерпания индекса, поэтому missing/extra/duplicate revisions fail-closed; отдельный полный
metadata response не нужен.

После merge допускается ровно один новый exact-main controlled-preparation-only read-only probe.
Успех требует полного исторического восстановления и `READY`; timeout/non-PASS запускает новую
repo-side причинную диагностику. WU7, bootstrap replay, retirement и cleanup не разрешаются этим probe.

### RU-budget estimate buckets после timeout `36281170917`

Controlled-preparation-only recovery `36281170917` на exact main
`7b03fa08435bc1b35ba00f3b6f84097c26eaaee8` после однопроходной paging candidate снова завершилась
`INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILED`; stage artifact отсутствует. Ранее полученный `GE_5000_ROWS`
не позволял отличить budget выше function ceiling от стоимости других стадий.

Следующий read-only diagnostic вычисляет приблизительный paced RU envelope только из manifest
binding cardinality: rows + число ≤9-row pages + pacing/query margins. Наружу выдаётся лишь один bucket:
`LT_5000_RU`, `GE_5000_LT_5500_RU`, `GE_5500_LT_6000_RU`, `GE_6000_RU` либо
`DIAGNOSTIC_FAILED`. Это не точный RU счётчик и не provider quota change; значение ≥6000 указывает,
что ожидаемые payload reads сами используют весь теоретический 600s × 10 RU/s потолок до подготовки
источника и остальных запросов. Exact row count, IDs и payload не публикуются.

После merge разрешена ровно одна свежая exact-main `staging_revision_cardinality_only` read-only
диагностика. Она выбирает следующую repo-гипотезу, но не разрешает controlled-preparation replay,
WU7, bootstrap, quota change, retirement или cleanup.

### RU-budget bucket после controlled-preparation timeout `36281170917`

Recovery `36281170917` на exact main `7b03fa08435bc1b35ba00f3b6f84097c26eaaee8` после однопроходной
paged reconstruction снова завершилась `INITIAL_BOOTSTRAP_RECOVERY_INVOKE_FAILED` на единственном
read-only invoke. Cardinality bucket `GE_5000_ROWS` с предыдущей версии оказался слишком широким,
чтобы установить, приближается ли один только paced revision read к timeout boundary.

Следующий repository-only diagnostic не запускает application reconstruction. На одном metadata-only
manifest read он вычисляет нижнюю оценку paced RU envelope из binding cardinality и текущего ограничения
9 rows/page плюс CPU-RU margin, затем выводит только один из bucket: `LT_5000_RU`,
`GE_5000_LT_5500_RU`, `GE_5500_LT_6000_RU`, `GE_6000_RU` либо `DIAGNOSTIC_FAILED`. Точное число,
source IDs и payload не публикуются. `GE_6000_RU` означает, что estimated read work alone reaches the
600 s × 10 RU/s ceiling before reference/application overhead.

После merge разрешена ровно одна свежая exact-main cardinality-only read-only probe. Она выбирает
следующую repository-гипотезу и не разрешает повтор controlled preparation, WU7, quota change,
bootstrap replay, cleanup или authority change.

### Read-only STAGING lineage check after stale-retirement rearm on `5d59d782a593cf6357bf0e9fee9e55782f7f126e`

After PR #838, orchestrator `36327644264` proved a pre-write stale-STAGING candidate and dispatched
exactly one bootstrap child `36327850242`. That child failed as `INITIAL_BOOTSTRAP_INVOKE_FAILED`
without application phase or runtime code. Mandatory post-invoke recovery returned
`RECOVERY_REQUIRED / STAGING_RUN_PRESENT`, with verified current empty and exact source diagnostics
unproven. Public evidence cannot tell whether stale retirement completed and the visible STAGING is a
fresh run from that child, or the original run remains.

The next repository-only correction adds an optional **full read-only recovery** correlation against
the exact latest failed bootstrap child. The workflow must verify that selected child is the failed
`R1 initial shadow bootstrap` run and that its single bootstrap-invoke step failed; an optional
`causal_bootstrap_run_id` must match that dynamically selected child. The recovery-only function reads
only the unique `STAGING.started_at` and compares it with the GitHub child `run_started_at`, then emits
one enum: `STAGING_STARTED_AFTER_BOOTSTRAP_CHILD`, `STAGING_PREDATES_BOOTSTRAP_CHILD`,
`STAGING_START_TIME_AMBIGUOUS`, `STAGING_RUN_CARDINALITY_INVALID`, or `DIAGNOSTIC_FAILED`. A five-second
cross-clock uncertainty window is fail-closed. No timestamp, run identifier, source digest, row,
payload, or financial data is emitted by the Function artifact.
The optional recovery JSON property is exactly `stagingRunLineageEvidence` and contains only one of
those allowlisted enums.

This classifier is temporal lineage evidence, not permission to resume or retire. The recovery remains
read-only, runs under the existing exact-main/full-recovery gates, and performs no readiness, bootstrap,
controlled rebuild, lifecycle, staging, or current-table mutation. Only one exact-main recovery is
allowed for the #838 child; an ambiguous/unavailable result stops without replay or cleanup. The
result distinguishes a pre-existing STAGING from a run started after that child, so the next root-cause
hypothesis can focus on the correct branch. Google remains authoritative; YDB remains shadow.

For the single post-merge recovery request, the PR carries:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Regression-Test: tests/migration-simulation/initial-bootstrap-recovery-probe.test.mjs
```

### Recovery Function deploy outcome remains unknown after exact-main run `36341844854`

PR #840 merged as `85c8a04b0b1fb7899c31aa2cc1e1bb65d0d79086`. Its exact-main canonical CI and
Browser Quality passed. Recovery autocontinue dispatched one read-only recovery run
`36341844854`, which failed at `Deploy recovery-only Function version`; the later
`Invoke exact read-only recovery tag once` step was `skipped`. The safe workflow signature is
`INITIAL_BOOTSTRAP_RECOVERY_DEPLOY_FAILED`. Therefore the YDB recovery Function was not invoked,
but the outcome of the Yandex Function-version create operation is unknown. The causal bootstrap
run ID also did not reach this deploy attempt; no STAGING lineage classification was produced.

Do not repeat the Function-version create or invoke its tag. The sole next provider action is an
exact-main read-only Function deployment recovery bound to failed run `36341844854`. The recovery
workflow proves that this is the latest failed recovery run, that the deploy step failed and that the
invoke step was skipped; it then reads only Function version/operation metadata and emits enum-only
evidence. It performs no Function-version create, Function invoke, Google read, or YDB read/write.
Its exact-version classifier requires a unique create operation within the failed run window, exact
operation-to-version identity, an active recovery tag, `nodejs22`, the recovery entrypoint and the
exact runtime service account. Missing, ambiguous, failed or incomplete evidence remains
unclassified and does not authorize replay.

For this single metadata classification, the PR carries exactly:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_FUNCTION_DEPLOY_CLASSIFICATION
Recovery-State: DEPLOYMENT_OUTCOME_UNCLASSIFIED
Recovery-Run-ID: 36341844854
Regression-Test: tests/tooling/initial-bootstrap-recovery-deploy-recovery-workflow.test.mjs
```

The missing causal run propagation and optional empty Function environment value are corrected in
repository code, but are not evidence of why Yandex rejected the failed create. Any later recovery
deploy or Function invoke requires fresh deployment classification and a new causal decision. No
bootstrap/orchestrator, staging resume/retirement, cleanup, timer or authority change follows from this
failure.

#### Read-only deploy classifier result was not sufficiently discriminating

The one exact-run deploy recovery `36347087928` published only
`CREATE_OPERATION_NOT_UNIQUE`. In that classifier revision the enum covered both zero and multiple
matching Yandex operations, so this result does not prove which condition occurred and does not
classify the Function-version create outcome. Do not replay the consumed provider query.

Repository review found that the existing controlled-rebuild deploy-recovery implementation already
reads both proven Yandex operation field spellings `created_by` / `createdBy` and `created_at` /
`createdAt`. The initial-bootstrap deploy classifier had accepted only snake_case, creating a
repository-side false no-match possibility. The bounded correction aligns it to those existing
field contracts and splits future diagnostics into `CREATE_OPERATION_NOT_OBSERVED` and
`CREATE_OPERATION_AMBIGUOUS`; both remain `RECOVERY_REQUIRED` and neither permits replay. Synthetic
fixtures cover each spelling and each cardinality. This correction is repository-only; it consumes no
additional provider classification for run `36341844854`, whose outcome remains unknown.

Owner subsequently authorized read-only probes across R1, recorded in active Issue #630. Because the
previous classifier ran before this repository-only metadata-shape correction and its enum conflated
zero/multiple operation matches, that authorization permits exactly one additional full provider
metadata classification for the same failed run on a new exact-main SHA. It uses the existing
`READ_ONLY_FUNCTION_DEPLOY_CLASSIFICATION` marker with the exact `Recovery-Run-ID` and remains
`Provider-Attempt: NOT_AUTHORIZED`. The autocontinue now re-proves the failed deploy/skipped invoke
phase before dispatch. This does not re-run the failed deploy and does not invoke Function, Google or
YDB. Each subsequent refinement must follow the standing delegation in `AGENTS.md` and
`docs/R1_COMPLETION_SPRINT.md`: new exact SHA, changed diagnostic discriminator, synthetic fixture and
the exact failed-run/phase guards. Same-query blind replay remains prohibited; write paths remain
disarmed.

Owner's standing R1 probe delegation permits one next exact-main diagnostic because PR #845 added a
new read-only discriminator for the proven `CREATE_OPERATION_NOT_OBSERVED` result. The classifier now
also evaluates the already-read version-list/tag evidence within the exact failed run's bounded
time window. It may emit `RECOVERY_TAGGED_VERSION_CANDIDATE_PRESENT`,
`RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW`, `RECOVERY_TAGGED_VERSION_AMBIGUOUS`, or
`RECOVERY_TAGGED_VERSION_METADATA_UNPROVEN`; none of these declare `APPLIED`/`NOT_APPLIED` or authorize
Function invocation. This probe reads only Function metadata/operations and does not invoke Function,
read Google or access YDB; it still proves the exact failed run phase before dispatch. Same SHA and
unchanged query/code replay remain forbidden.

This additional probe's marker selects only the same failed run:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_FUNCTION_DEPLOY_CLASSIFICATION
Recovery-State: DEPLOYMENT_OUTCOME_UNCLASSIFIED
Recovery-Run-ID: 36341844854
Regression-Test: tests/tooling/initial-bootstrap-recovery-deploy-classifier.test.mjs
```

### Read-only deploy-classification autocontinue stopped before provider dispatch on `2b6658171b01d5a99f4373e6be8b6152eb2edd29`

Exact-main CI, Browser Quality and CodeQL passed after PR #841. Recovery autocontinue `36344477909`
verified the single merged R1 PR and parsed its read-only deployment-classification marker, but stopped
before dispatch with `R1_RECOVERY_AUTOCONTINUE_DEPLOY_CLASSIFICATION_CHANGESET_INVALID`. The marker's
Regression-Test path included a nonexistent `r1-` prefix; the actual added test is
`tests/tooling/initial-bootstrap-recovery-deploy-recovery-workflow.test.mjs`. No
`R1 initial bootstrap recovery deploy recovery` run was created, and no Yandex provider query, deploy,
Function invoke, Google read or YDB read/write occurred.

The successor corrects the marker to the exact existing regression path and makes the changeset guard
require the autocontinue caller workflow, its test, and this runbook. This repairs the
pre-dispatch gate only; it does not change provider classification or authorize a deployment. Since
the read-only classification did not reach the provider, exactly one retry of that same read-only
classification for failed recovery run `36341844854` may be requested on a new exact-main SHA. The
write-capable bootstrap/recovery deploy and invoke paths remain disarmed.

The successor PR carries one read-only marker:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_FUNCTION_DEPLOY_CLASSIFICATION
Recovery-State: DEPLOYMENT_OUTCOME_UNCLASSIFIED
Recovery-Run-ID: 36341844854
Regression-Test: tests/tooling/initial-bootstrap-recovery-deploy-recovery-workflow.test.mjs
```

### Second read-only deploy-classification dispatch was gated before provider on `d284ee221602f80e528a510d3f1d45272f987997`

PR #842 passed exact-main CI, Browser Quality and CodeQL. Autocontinue `36346118685` parsed the exact
read-only marker and stopped again with `R1_RECOVERY_AUTOCONTINUE_DEPLOY_CLASSIFICATION_CHANGESET_INVALID`.
The corrected test path and caller workflow were present in the PR; the guard's additional requirement
that `AGENTS.md` also change was unrelated to this caller-only path correction and prevented dispatch.
No deploy-recovery workflow run was created; no Yandex, Function, Google or YDB action occurred.

The next change removes only that unrelated file requirement. The changeset proof still requires the
exact marker's regression test, the autocontinue caller workflow, and this runbook. The marker remains
bound to failed run `36341844854`; this is still the same single read-only classification, not a second
provider recovery, because neither prior autocontinue reached the provider. Bootstrap, recovery
Function deployment/invocation, YDB/Google access, cleanup and authority changes remain disarmed.

### PR #847 read-only version-window probe remained pre-dispatch gated on `0b07238c0d152c803fa04019e1e899422cd58eb1`

PR #847 passed exact-main CI, Browser Quality and CodeQL. Autocontinue `36354465989` correctly proved
the exact latest failed recovery run and failed-deploy/skipped-invoke phase, but the changeset guard
still required the already-merged caller workflow itself to change. PR #847 modified the recovery
workflow, classifier implementation, regression fixture and runbook, but not the caller. The marker
was rejected as `R1_RECOVERY_AUTOCONTINUE_DEPLOY_CLASSIFICATION_CHANGESET_INVALID`; the deployment
recovery workflow was not dispatched and no provider state was read.

The successor changeset guard accepts either a marker-only caller correction (exact regression test +
autocontinue workflow + runbook) or a classifier/root-cause correction (exact regression test +
recovery-deploy workflow + classifier script + runbook). It does not require the already-verified
autocontinue caller to change again for every new classifier discriminator. The Owner-authorized
version/tag-window classification remained unconsumed at this point. No deploy, invoke, Google/YDB
access, replay or cleanup followed this pre-dispatch stop.

### PR #848 exact-run read-only classifier completed with diagnostic failure on `2052041417e58ac7d183a2eaca0b63d3ec0b815f`

PR #848 passed exact-main CI, Browser Quality and CodeQL; the merged main SHA also passed all three.

Autocontinue `36356292384` dispatched the Owner-authorized read-only classification
for exact failed run `36341844854`. Recovery workflow `36356312191` re-proved exact main, latest failed
run and deploy-failed/invoke-skipped phase, completed its Function metadata reads, and published only
`DIAGNOSTIC_FAILED`. This does not classify the deploy as applied or not applied. No Function version
was created or invoked; no Google or YDB access, replay, cleanup or authority change occurred. The
probe is consumed. Gate C `36356292388` stopped at its missing authority marker before readiness,
deploy or invoke.

The next repository-only refinement preserves fail-closed behavior but distinguishes invalid top-level
classifier inputs, malformed version-list entries, invalid metadata JSON, and unexpected internal
classifier errors as separate enum-only diagnostics. It does not infer which condition occurred in
`36356312191`; it enables a new-SHA, exact-run read-only refinement only after synthetic regression
coverage and fresh exact-main gates.

### PR #849 read-only refinement isolated version-list entry metadata on `853413ce3cff72923e4d76476a2ad6953e176d04`

PR #849 passed exact-main CI, Browser Quality and CodeQL; post-merge checks on main `853413ce3cff72923e4d76476a2ad6953e176d04` also passed. Recovery autocontinue `36357377893` passed the exact failed-run and phase gates and dispatched one metadata-only classification. Recovery workflow `36357395136` completed and published only `RECOVERY_VERSION_LIST_ENTRY_INVALID` after reading Function version/operation metadata. It does not determine which record field was malformed and does not classify deploy application state. No Function version was created or invoked; Google/YDB, cleanup and replay were not accessed.

The next repository-only discriminator splits the known invalid-entry branch into non-object entry, tag-array shape and timestamp shape enums with synthetic fixtures. Unknown or malformed metadata remains fail-closed; no aliases or payload output are added. A new exact-SHA read-only refinement for failed run `36341844854` is the only permitted provider continuation after the correction passes all gates.

### PR #850 metadata-only refinement classified the invalid version-list field as tags on `adbbcc0fb1ff06bc12db7e3b31feae082569c8c1`

PR #850 and post-merge main passed CI, Browser Quality and CodeQL. Recovery autocontinue `36358010139` passed the exact failed-run and failed-deploy/invoke-skipped guards; recovery workflow `36358023923` completed and published only `RECOVERY_VERSION_TAGS_INVALID`. This identifies the tag-array validation branch, without exposing provider metadata or classifying the failed Function create as applied/not applied. No deploy, invoke, Google/YDB access, replay or cleanup occurred.

Provider schema proof: Yandex Cloud `Version.tags` is declared `repeated string` in [`function.proto`](https://github.com/yandex-cloud/cloudapi/blob/master/yandex/cloud/serverless/functions/v1/function.proto); `ListFunctionsVersionsResponse.versions` is repeated `Version` in [`function_service.proto`](https://github.com/yandex-cloud/cloudapi/blob/master/yandex/cloud/serverless/functions/v1/function_service.proto). [ProtoJSON presence/default semantics](https://protobuf.dev/programming-guides/json/#presence-and-default-values) permit omission of empty repeated fields. Therefore an omitted `tags` property means the known empty repeated field; explicit null or a wrong type remains invalid. The next correction treats omitted tags as empty, ignores timestamps on untagged versions, and keeps timestamp proof mandatory for versions carrying the recovery tag. Synthetic fixtures cover these distinctions; no aliases or unknown schema vocabulary are introduced.

### PR #851 read-only current-version classification found no tagged candidate in the failed-run window on `a18d67c6b44b6c2e7da5cc67aa4f1c9957c30f72`

PR #851 passed exact-main CI, Browser Quality and CodeQL; post-merge main checks also passed. Recovery autocontinue `36358852718` dispatched the one read-only refinement for failed run `36341844854`; workflow `36358866111` re-proved exact main/latest failed run/failed deploy plus skipped invoke, then published only `RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW`. The exact result means no current recovery-tagged version was observed within the failed-run window; it does not prove `NOT_APPLIED` or establish a deploy outcome. No Function version was created/invoked, and Google/YDB, replay, cleanup and authority changes were not involved.

The next bounded diagnostic uses the documented `ListTagHistory` API for only `r1-initial-bootstrap-recovery`. `ListFunctionTagHistoryRecord` is repeated and provides tag, version ID, `effective_from` and `effective_to`; an omitted empty record list and omitted empty `next_page_token` use ProtoJSON default semantics. One page of up to 1000 entries is sufficient only if `next_page_token` is empty, otherwise classification remains incomplete. Synthetic fixtures will test an exact-window historical tag assignment, no matching event, ambiguous events, malformed metadata and pagination-incomplete fail-closed behavior. This can distinguish current absence from historical tag movement without inferring deploy success.

### PR #852 schema-backed tag-history read returned no in-window recovery candidate on `efea1dc6e3f76e7136c14026b9ba8f402cb34b15`

PR #852 passed exact-main CI, Browser Quality and CodeQL; post-merge main checks passed. Recovery autocontinue `36360220835` passed the exact failed-run and failed-deploy/invoke-skipped gates. Read-only deploy classification `36360268146` completed, including the bounded tag-history request, and published only `RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW`. No Function deploy/invoke, Google/YDB access, replay, cleanup or authority change occurred. The failed deployment remains unclassified.

Repository review then found that the classifier compared the version runtime service account to the WIF deployment caller ID. The failed recovery workflow separately resolves the runtime service account for `--service-account-id`; these identities have different roles. The successor passes those exact distinct identities separately and synthetic fixtures assert they are not interchangeable. This is a repository causal correction only; the next new-SHA probe remains read-only.

### PR #853 exact-run read-only classifier still found no recovery-tagged candidate on `664127f3cdef791cf2efd31442109f0f6b427752`

PR #853 passed exact-main CI, Browser Quality and CodeQL; post-merge main checks `36361083553`, `36361083505` and `36361083389` passed. Recovery autocontinue `36361151469` dispatched the exact failed-run classifier once. Run `36361168144` passed exact-main and failed-run/phase checks and published only `RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW`. Correcting deployer/runtime identity roles did not yield a tagged/history candidate. The result still does not prove `APPLIED` or `NOT_APPLIED`; no Function deploy/invoke, Google/YDB, replay, cleanup or authority change occurred.

The next repository-only diagnostic examines untagged Function versions within the exact failed-run time window using schema-proven creation time, runtime, entrypoint, runtime service account and status. It emits only a unique candidate/ambiguous/unproven/none enum; it cannot infer deployment success. Synthetic fixtures must preserve fail-closed behavior.

### PR #854 exact-window untagged-version classification still found no candidate on `cd29e5c61a77d97600fd2bfea7068d4aa575c2c7`

PR #854 passed exact-main CI, Browser Quality and CodeQL; post-merge main checks passed. Recovery autocontinue `36361980044` passed exact failed-run/deploy-failed/invoke-skipped guards and dispatched one read-only classification. Run `36361998956` published only `RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW`, after tag-history and exact-window untagged-version checks. The deploy outcome remains unknown; this does not prove `NOT_APPLIED`. No Function deploy/invoke, Google/YDB access, replay, cleanup or authority change occurred.

The successor first makes CLI list completeness explicit: cap both versions and operations reads at the documented 1000-entry maximum and emit distinct incomplete enums when a full page is reached. A candidate-absence result is valid only when both lists fit below the limit; no raw counts or provider payload are published. Synthetic fixtures cover full-list fail-closed behavior.

### PR #855 bounded metadata lists completed the exact failed-run classification on `78c9f162c5c9ec172ab39b2d99f7f488002d3cc3`

PR #855 passed exact-main CI, Browser Quality and CodeQL; post-merge checks `36362657962`, `36362657922` and `36362657977` passed. Recovery autocontinue `36362707206` passed the exact failed-run/deploy-failed/invoke-skipped guards. Recovery classification `36362726878` completed all read-only queries and published only `RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW`. Both Function version and operation lists were below the 1000-entry incomplete boundary; current-tag, historical tag and exact-window untagged-version checks found no candidate. No `APPLIED`/`NOT_APPLIED` outcome is inferred. No Function version was deployed or invoked; Google/YDB, replay, cleanup and authority changes were not involved.

The exact failed recovery Function deploy remains unclassified, and no candidate, incomplete-list or schema-shape evidence remains to motivate an identical query. Do not redeploy/invoke, replay or clean up. Resume repository work only if a distinct evidence-backed discriminator arises; otherwise retain this read-only stop state. Google remains authoritative; no `COMMITTED` baseline is proved.

### Owner-authorized read-only audit source opening for exact recovery run `36341844854`

Owner authorized opening a read-only provider evidence source in chat; the authorization is recorded in active Issue #630. The bounded source probe uses documented Yandex `TrailService.List` for the Function folder and, only for one active pre-existing Cloud Logging destination, `yc logging read` over the exact failed-run interval filtered to the schema-documented Serverless `CreateFunctionVersion` event and Function ID. Serverless Audit Trails event schema documents event status, actor, resource/version IDs, runtime, entrypoint, runtime service account and version tags. It is used only internally in runner temporary storage; output remains enum-only.

The documented minimum read roles are `audit-trails.viewer` for audit trail/events and `logging.reader` for log group entries. This PR does not add or remove IAM bindings. Permission-denied, missing trail, unsupported destination, ambiguous source or unavailable event evidence each remains an enum stop; no inference of `NOT_APPLIED`. If existing WIF does not have the narrow read permissions, the workflow will publish only the appropriate denial enum, after which IAM scope must be separately recorded and bounded before source access. Function deploy/invoke, Google/YDB access, replay, cleanup, timer, cutover and authority changes remain excluded.

### PR #857 audit source read stopped at existing WIF permission boundary on `3c89bf799e4765822df583af6c846dc40680074e`

PR #857 passed exact-main CI, Browser Quality and CodeQL. Recovery autocontinue `36381401315` dispatched the exact-run read-only classification. Workflow `36381426432` re-proved main/run/phase, completed existing Function metadata queries, then the Audit Trails list returned only `AUDIT_TRAIL_LIST_PERMISSION_DENIED`; audit log read was not attempted. The existing WIF identity has no source read permission. No IAM binding changed, no raw trail/log response was published, and no Function deploy/invoke, Google/YDB, replay, cleanup or authority change occurred. Deployment remains unclassified and no `COMMITTED` baseline is proven.

As recorded at PR #857, the proposed temporary source-reader scope was `audit-trails.auditor` on the Function folder for trail discovery, then `audit-trails.viewer` only on a unique trail and `logging.reader` only on its exact Cloud Logging group, with before/after read-back. The trail/log IDs are discovered internally and never stored in artifacts. At that point no IAM change had been made and Owner authorization was still required; the later authorization and narrower first binding are recorded below.

### Owner-authorized temporary Audit Trails viewer and HTTP failure refinement

After the exact-main denial, Owner explicitly authorized temporary read-only source-reader bindings with before/after read-back and removal. Fresh discovery confirmed the exact failed recovery run `36341844854` is still the latest failed recovery, its Function-version deploy step failed, and its invoke step was skipped. The current WIF identity had no Audit Trails viewer binding before this change. A temporary `audit-trails.viewer` binding was added only to that WIF identity at the Function folder and independently read back. Before PR #859's new-SHA probe, no provider source query had run since the grant. No `audit-trails.auditor`/broader role, Logging role, trail/log group creation, Function deploy/invoke, Google/YDB access, replay, cleanup or authority change occurred.

The earlier workflow merged both HTTP 401 and 403 into `AUDIT_TRAIL_LIST_PERMISSION_DENIED`, so that safe result could not distinguish authentication failure from a missing read role. This successor changes the classifier to emit `AUDIT_TRAIL_AUTHENTICATION_REQUIRED` for 401, retain `AUDIT_TRAIL_LIST_PERMISSION_DENIED` for 403, and retain the generic read-failed enum otherwise. Synthetic regression fixtures cover 401/403 separation and unknown statuses. The new exact-SHA probe remains read-only and exact-run/phase-bound; it may read Cloud Logging only after one unique eligible pre-existing Cloud Logging destination is proven. If such a destination is found, `logging.reader` may be added only on that exact group, and all temporary bindings must be removed with independent after-read verification. Deployment outcome remains unclassified; no `COMMITTED` baseline is proven.

### PR #859 exact-main Audit Trails query found no Function-folder source; temporary viewer was removed

PR #859 passed exact-main CI `36441967169`, Browser Quality `36441967176`, and CodeQL `36441967097`. Recovery autocontinue `36442087393` passed exact-main, exact failed-run/deploy-failed/invoke-skipped, and changeset gates, then dispatched the read-only classification once. Workflow `36442125610` re-proved the exact run/phase, completed Function metadata reads, and successfully listed Audit Trails using the temporary viewer binding. Its enum-only output was `RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW`, `AUDIT_TRAIL_SOURCE_NOT_CONFIGURED`, and `AUDIT_EVENT_READ_NOT_ATTEMPTED`. No Cloud Logging event read was attempted because no eligible pre-existing trail was configured at the Function-folder scope. The result does not classify the Function-version deployment as `APPLIED` or `NOT_APPLIED`.

The temporary `audit-trails.viewer` binding, whose before-state was absent, was removed after this single probe; an independent folder binding read confirms it is absent. No `logging.reader` role was added. No Function deploy/invoke, Google/YDB access, replay, cleanup, timer, cutover or authority change occurred. Parent-scope audit trails were not queried; any broader source discovery needs its own fresh scope and authority evaluation. No `COMMITTED` baseline is proven.

### Owner-authorized parent-Cloud Audit Trails source refinement for run `36341844854`

Owner authorized one temporary `audit-trails.viewer` binding for the bootstrap WIF identity at the parent Cloud scope, limited to a single source-discovery/recovery cycle. No Cloud binding has been made yet. Fresh reconciliation confirms `main=275d09ae0f4c554a5756d4e356e0269c64423d94`, no competing R1 provider writer, failed recovery `36341844854` still latest with deploy-failed/invoke-skipped, and the earlier Function-folder viewer binding absent.

The exact Yandex Cloud API contract is not a `TrailService.List(cloudId)` call: `ListTrailsRequest` requires `folder_id`; `FolderService.List` requires `cloud_id`. This refinement therefore lists only folders in the Function's exact parent Cloud (hard bound 100 folders, fail-closed on pagination/incomplete enumeration), then calls `TrailService.List` for each listed folder. It accepts source coverage only when the documented management-event `resource_scopes` contain exactly the target Cloud (`resource-manager.cloud`) or target Function folder (`resource-manager.folder`); unknown scope types/shape remain `AUDIT_TRAIL_COVERAGE_UNPROVEN`. A Cloud Logging read remains conditional on exactly one pre-existing active trail whose coverage includes the target and whose configuration predates the failed run. Cloud and folder/trail IDs remain only in runner temporary files and never enter artifacts.

Synthetic fixtures cover complete/incomplete Cloud folder inventory, exact target-folder presence, cloud-wide and exact-folder management-event coverage, unrelated folder scopes, unknown scope fail-closed behavior, temporal changes, ambiguous destinations, and empty source. The PR marker is `Provider-Attempt: NOT_AUTHORIZED`, `Recovery-Probe: READY`, `Expected-Transition: READ_ONLY_FUNCTION_DEPLOY_CLASSIFICATION`, `Recovery-State: DEPLOYMENT_OUTCOME_UNCLASSIFIED`, and exact `Recovery-Run-ID: 36341844854`. No source query runs until the change is merged, exact-main CI passes, and autocontinue proves the exact failed run/phase. Only the Owner-approved temporary Cloud viewer may be added then; do not widen to `resource-manager.viewer`, organization scope, or any other role. Remove the Cloud viewer and independently verify it absent immediately after the one classification. A denied folder inventory stops and revokes without an additional role; no event payload, deploy/invoke, Google/YDB, replay, cleanup, or authority changes are allowed.

### PR #861 recovery stopped at Folder Get before Audit Trails List; Cloud viewer was not yet bound

After PR #861 merge and exact-main CI, recovery autocontinue `36452537886` dispatched recovery `36452570754` before the temporary Cloud viewer was installed. The exact failed-run/deploy-failed/invoke-skipped guards passed and Function metadata reads completed, but the initial Resource Manager Folder Get returned only `AUDIT_TRAIL_FOLDER_METADATA_PERMISSION_DENIED`. Audit Trails List was not attempted and event evidence remained `AUDIT_EVENT_READ_NOT_ATTEMPTED`. The Cloud binding read still contains no WIF viewer; no IAM mutation occurred. This is a consumed read-only recovery result, not deployment evidence.

The successor changes the diagnostic request path: it uses a dedicated masked `YC_R1_CLOUD_ID` GitHub secret and starts directly with FolderService.List for that Cloud, validating that the exact target Function folder is in the complete bounded response. It removes the denied Folder Get dependency; an absent Cloud ID yields `AUDIT_TRAIL_CLOUD_SCOPE_CONFIG_INVALID`, and missing target membership/page completeness fails closed. Populate the secret and bind only the Owner-authorized temporary `audit-trails.viewer` after PR checks pass and before merge, so the one post-merge exact-main autocontinue does not race the authorization. Independently read the Cloud binding before/after, then remove the temporary viewer immediately after the one classification. No source TrailService.List/event read has yet been made at Cloud scope; a new-SHA PR and synthetic regression test are required before retry.

### PR #862 cloud inventory/trail classifier returned one ambiguous metadata enum; event read did not run

PR #862 exact-main CI `36457380871`, Browser Quality `36457380929`, and CodeQL `36457378997` passed. Recovery autocontinue `36457497263` passed marker/changeset/exact-run/deploy-failed/invoke-skipped gates and dispatched workflow `36457545606` once. The run validated the explicit Cloud ID secret and reached Cloud FolderService.List, then the Cloud inventory/trail classifier emitted only `AUDIT_TRAIL_METADATA_INVALID`. Because inventory and per-trail validation shared this enum, available evidence does not establish whether per-folder TrailService.List ran. No Cloud Logging event read occurred; event evidence was `AUDIT_EVENT_READ_NOT_ATTEMPTED`. The Function deployment remains unclassified. The temporary Cloud `audit-trails.viewer` binding was removed after the result and independently verified absent. No other role, Function deploy/invoke, Google/YDB, replay, cleanup, timer, cutover or authority change occurred.

The Folder proto documents `ACTIVE`, `PENDING_DELETION`, and `DELETING`. The previous inventory classifier collapsed unsupported folder metadata, cloud mismatch, duplicate IDs and valid non-ACTIVE statuses into one enum. The next exact-SHA successor emits distinct enums for these conditions, accepts only the three schema-defined folder statuses, continues bounded TrailService.List for non-active sibling folders, and still requires the exact Function folder itself to be `ACTIVE`. Unknown status/vocabulary and cloud mismatch remain fail-closed. Synthetic fixtures must cover every split enum before a new exact-main read-only probe. No same-SHA replay or event query is authorized.

### PR #863 refined Folder statuses; Cloud source classifier still returned ambiguous metadata

PR #863 passed PR CI `36459992058`, Browser Quality `36459992160`, and CodeQL `36459987865`; post-merge exact-main CI `36460471110`, Browser Quality `36460471309`, and CodeQL `36460472418` passed. With the Owner-approved temporary Cloud viewer present before merge, recovery autocontinue `36460574370` passed the exact failed-run/deploy-failed/invoke-skipped and changeset gates, then dispatched recovery `36460606358` once. The enum-only result again contained `AUDIT_TRAIL_METADATA_INVALID` with `AUDIT_EVENT_READ_NOT_ATTEMPTED`. The shared enum does not establish whether per-folder TrailService.List ran; no event read occurred. The deployment remains unclassified.

The temporary Cloud `audit-trails.viewer` binding was removed after the result and independently verified absent. No Logging or Resource Manager role was added; no Function deploy/invoke, Google/YDB, replay, cleanup, timer, cutover or authority change occurred. The widened Folder schema classifier still groups the precise inventory field failure; the next new-SHA synthetic refinement splits response/entry/ID/cloudId/status failures and JSON parse errors. No same-SHA replay or inferred deployment outcome is allowed.

### PR #864 Cloud source classifier still returned the generic enum; temporary Cloud viewer revoked

PR #864 passed exact-head CI `36462120188`, Browser Quality `36462120361`, and CodeQL `36462116453`; exact-main checks `36462593458`, `36462593451`, and `36462593487` passed after merge. Recovery autocontinue `36462701288` dispatched exact-run recovery `36462743638` once. The enum-only result remained `AUDIT_TRAIL_METADATA_INVALID` with `AUDIT_EVENT_READ_NOT_ATTEMPTED`; the shared enum does not distinguish inventory, TrailService.List response, or trail-entry validation. Deployment remained unclassified. The temporary Cloud `audit-trails.viewer` binding was removed immediately and independently verified absent. No deploy/invoke, Google/YDB, replay, cleanup, or authority change occurred.

The next read-only discriminator separates cloud coverage inputs, TrailService.List response shape/cardinality/JSON parsing, per-trail owner folder/cloud IDs, status, timestamps, destination, and classifier-internal failures. It also fails coverage closed for deprecated/unknown filtering policies and non-empty include/exclude rules, because those may exclude the exact CreateFunctionVersion event. Synthetic fixtures cover each branch. No same-SHA replay is allowed.

### PR #866 recovery stopped at the GitHub exact-CI lookup before Yandex authentication

PR #866 merged with exact-main CI run `36473073042` later completing successfully, but its automatic read-only recovery child `36473228760` failed at `RECOVERY_DEPLOY_EXACT_SHA_CI_MISSING` in `Prove exact failed deploy and read-only boundary`. Yandex CLI installation and OIDC token exchange were skipped, so there was no Yandex metadata/list query, Function action, Audit Trails request, event read, or IAM operation. Cloud viewer remained absent. This does not classify the failed Function-version deployment.

The successor stops depending on an eventually-visible workflow-run list. Recovery autocontinue passes the exact successful triggering CI run ID; the recovery preflight fetches that one run and synthetic-tests ID/name/SHA/main/push/completed/success fields before any Yandex CLI or token exchange. This is a GitHub metadata-only preflight refinement. The next provider call remains the already-approved exact-run read-only classification, only after the new SHA is merged and its full gates pass. No replay or write path is armed.

### PR #865 TrailService.List response-shape refinement still stopped before event reads

PR #865 passed exact-head CI `36469214200`, Browser Quality `36469213994`, and CodeQL `36469209742`; post-merge exact-main CI `36469790971`, Browser Quality `36469790899`, and CodeQL `36469790605` passed. Recovery autocontinue `36469880673` passed the exact-run/phase/changeset gates and dispatched recovery `36469918792` once. The enum-only result was `AUDIT_TRAIL_TRAIL_LIST_RESPONSE_INVALID`, with `AUDIT_EVENT_READ_NOT_ATTEMPTED`; the deployment remains unclassified. The Cloud viewer was removed after this run and independently verified absent. No Cloud Logging read, write-capable Function operation, Google/YDB, replay, cleanup, or authority change occurred.

The previous refinement still coalesced a malformed list root, a missing/non-array `trails` field, and an invalid `nextPageToken`. The next new-SHA discriminator splits those cases and keeps nonempty valid pagination tokens as `AUDIT_TRAIL_LIST_INCOMPLETE`. Synthetic fixtures cover each status; no same-SHA replay or audit-event read without a uniquely proven source is authorized.

### PR #867 Audit Trails source decision after omitted protobuf repeated field on `e4121479ac3d0c5360af4a7ca8037be4cd6a8a3e`

Post-merge read-only recovery `36476636505` reached `TrailService.List` and returned
`AUDIT_TRAIL_TRAILS_FIELD_INVALID`; event read remained `AUDIT_EVENT_READ_NOT_ATTEMPTED`. The exact
main stayed `e4121479ac3d0c5360af4a7ca8037be4cd6a8a3e`, no write-capable Function operation ran, and
the temporary Cloud `audit-trails.viewer` binding was absent after the earlier one-shot cycle. This
failure signature is consistent with protobuf JSON omitting an empty repeated field; it does not
establish an empty list or prove source absence by itself.

The causal successor treats only an omitted protobuf repeated `trails`/`folders` member as its
canonical empty-list value; explicit `null`, wrong types, malformed roots/entries, invalid or
non-empty page tokens, provider errors, incomplete enumeration, unknown schema/vocabulary, ambiguous
coverage/destination, and event-read failures remain fail-closed. Existing response validation,
temporal bounds, exact Cloud/Function coverage, destination validation and event identity checks stay
in place. Synthetic fixtures cover omitted/empty/malformed response cases and all existing response,
pagination, coverage, metadata and event branches.

Each exact failed-run classification now emits one terminal `auditSourceDecision` together with the
source and event enums:

- `EXISTING_APPLICABLE_AUDIT_SOURCE`: one pre-existing, active, covering Cloud Logging source was
  proven and its event query/classification was performed. Use the exact event result; only the
  existing exact-version event classifier can establish `EXACT_RECOVERY_VERSION_CREATED`.
- `NO_APPLICABLE_PREEXISTING_AUDIT_SOURCE`: complete discovery proves no configured, active,
  pre-existing source covers the target. Stop this Audit Trails branch and move to a different
  provider metadata/root-cause model; do not add another list discriminator.
- `SOURCE_EVIDENCE_UNUSABLE` / `SOURCE_EVIDENCE_AMBIGUOUS`: malformed/incomplete/unreadable source,
  unsupported destination, absent matching event, or ambiguous source/event prevents a conclusion.
  Stop this Audit Trails branch and use an independent already-bounded provider metadata path, or
  preserve `DEPLOYMENT_OUTCOME_UNCLASSIFIED`; no further Audit Trails-only PR/probe cycle.

This Incident-M does not authorize Function deploy/invoke, Google/YDB access, replay, cleanup, timer,
cutover, or authority change. Any one future read-only recovery remains exact-main and exact-failed-run
bound. Owner anti-S-unit rules are synchronized here, `AGENTS.md`, and `docs/R1_COMPLETION_SPRINT.md`
in the same causal PR.

### Owner-authorized one-shot recovery-only Function deploy after PR #869

Exact-main deploy classification `36554205552` reached its provider reads and returned
`RECOVERY_TAGGED_VERSION_NOT_OBSERVED_IN_WINDOW`; the Audit Trails source decision was
`SOURCE_EVIDENCE_UNUSABLE` because the complete configured-Cloud folder inventory did not contain the
exact Function folder. Event read was `AUDIT_EVENT_READ_NOT_ATTEMPTED`. This closes the Audit Trails
branch; no additional Audit Trails query/discriminator is allowed. The provider classification does not
prove `APPLIED` or `NOT_APPLIED`, and does not authorize a bootstrap/recovery Function invoke.

After this exact-run deploy classification, Owner authorized in chat exactly one new recovery-only
Function-version create for failed recovery run `36341844854`, with **Function invoke explicitly out of
scope**. The authorization was recorded on active Issue #630. It does not authorize another attempt,
YDB/Google access, IAM changes, cleanup, or any financial write. The next causal PR uses a dedicated
deploy-only workflow and one machine-readable block:

```text
Provider-Attempt: READY
Observed-Signature: INITIAL_BOOTSTRAP_RECOVERY_DEPLOY_FAILED
Expected-Transition: RECOVERY_ONLY_FUNCTION_VERSION_CREATE_CLASSIFIED
Recovery-State: DEPLOYMENT_OUTCOME_UNCLASSIFIED
Circuit-Rearm: OWNER_AUTHORIZED_SINGLE_RECOVERY_DEPLOY
Recovery-Run-ID: 36341844854
Regression-Test: tests/tooling/initial-bootstrap-recovery-deploy-attempt-workflow.test.mjs
```

The workflow re-proves exact current main/CI, exact source PR and this latest failed run's deploy-failed
/ invoke-skipped phase, shared writer exclusion, private trigger-free Function boundary, exact runtime
SA and Lockbox secret metadata. It executes one `yc serverless function version create --retry 0`, captures
stderr only in runner-temporary storage, and publishes a synthetic-tested allowlisted result:
`PERMISSION_DENIED` with a bounded resource boundary, another documented provider status class, or
`OTHER/PROVIDER_ERROR_DETAIL_UNAVAILABLE`; successful CLI completion emits
`RECOVERY_FUNCTION_VERSION_CREATE_ACCEPTED_NO_INVOKE`. The raw provider response, IDs and secret values
are never published. It does **not** call the Function or access YDB/Google.

Every possible result consumes the one-shot authority for this exact failed run. A concrete
`INVALID_ARGUMENT`-class result permits a repository request fix; a proven missing permission is a
separate exact-scope authority boundary; resource/policy/unclassified evidence stops for a new causal
decision. Success means only that provider accepted the recovery-only version create, not that YDB is
classified or `COMMITTED`. No automatic second deploy, Function invoke, IAM mutation, replay, cleanup,
timer, cutover or authority change follows.

#### PR #870 was a pre-provider stop; authorized create was not consumed

The first deploy-only successor reached only its GitHub preflight and failed with
`RECOVERY_DEPLOY_ATTEMPT_ISSUE_INACTIVE`; `Create exactly one read-only recovery Function version without
invoking it` was `skipped`. No Yandex CLI/token exchange or provider operation occurred. Root cause was
the repository comparing REST issue state to uppercase `OPEN` although the exact endpoint returns
lowercase `open`. Therefore the one Owner-authorized create action was **not consumed**.

The next distinct-SHA successor uses active control Issue #630 with the lowercase REST state, and uses
the prior workflow's exact deploy-step conclusion to distinguish this `skipped` preflight stop from a
create attempt that reached the provider. A prior exact attempt whose create step was success/failure/
cancelled consumes authority; missing, duplicate, incomplete, or ambiguous run/job/step evidence blocks.
Same-SHA replay is forbidden even when a prior create step was skipped. The owner-authorized attempt
remains limited to failed run `36341844854`, one `--retry 0` create, no invoke, and no IAM/YDB/Google
mutation.

#### Missing `main` push-CI after PR #871 merge

PR #871 merged as exact `main` SHA `a2e9f0d27dc127a93c6a97b84735e4b2819098a2`. GitHub records the
`PullRequestEvent` as merged and advances protected `main`, but repository events expose no matching
`PushEvent`; the SHA has no Actions run, check suite or commit status. Repository Actions are enabled,
and canonical CI is active with `push: branches: [main]`. Attempting to dispatch it through the API
returned `Workflow does not have 'workflow_dispatch' trigger`. Available provider evidence does not
identify why GitHub omitted the push-triggered workflow; this is not a CI test failure.

The bounded recovery adds manual dispatch to the same canonical CI workflow. The dispatch-only guard
requires the canonical repository, `refs/heads/main`, checkout `HEAD == GITHUB_SHA`, and a fresh
protected-main API read equal to that SHA. It runs the unchanged full `npm run check`, builds and uploads
the same exact-SHA artifact only on main, and does not arm workflow-run autocontinue (those R1
consumers remain restricted to successful `push` CI). Exact-source restore and CI-run classification
accept only one successful completed `CI` run on `main` with the exact SHA and event `push` or
`workflow_dispatch`; pull-request, other-event, mismatched, duplicate or incomplete runs remain
fail-closed. This gives a recovery path when a merge push event is missing without fabricating a check,
reusing an artifact from another SHA, or dispatching a provider workflow automatically.

Once this fix is merged, manually dispatch canonical CI on the exact protected current `main`, verify
its successful run and exact-source artifact, then re-evaluate the one-shot deploy-only gates. The
one-shot create for failed recovery run `36341844854` remains unused; Function invoke remains out of
scope.

#### PR #870 stopped before the authorized create on the issue-state casing guard

The Owner-authorized deploy-only continuation `36590773848` failed in
`Prove exact merged authorization, CI and failed deploy boundary` with
`RECOVERY_DEPLOY_ATTEMPT_ISSUE_INACTIVE`. The provider CLI, OIDC exchange, Function preflight and deploy
step were all skipped; specifically `Create exactly one read-only recovery Function version without
invoking it` was `skipped`. No provider mutation or invoke occurred, so the one-shot create allowance was
not consumed.

Root cause was a repository preflight comparison against uppercase `OPEN`, while GitHub REST issue
metadata uses lowercase `open`. The next distinct-SHA successor normalizes this exact active-issue guard
to the canonical REST value and replaces workflow-run-exists deduplication with deploy-step evidence:
only a prior exact failed-run attempt whose create step was reached consumes the allowance. A proven
pre-write `skipped` create may proceed once on a new SHA; ambiguous/missing phase evidence and same-SHA
replay still fail closed. Synthetic history fixtures cover `skipped`, success, failure, cancelled,
active, duplicate, incomplete, and unclassified attempts. The PR marker remains bound to failed run
`36341844854`, and the newly authorized create-only attempt still never invokes the Function.

#### Exact one-shot marker and multiple prewrite stops after PR #872

Canonical push-CI `36604027511` passed on exact main `2263cd99861feca710d2406cb85a063308d9829b` and
published its exact-source artifact. CI-triggered bootstrap autocontinue did not dispatch an orchestrator:
the `OWNER_AUTHORIZED_SINGLE_RECOVERY_DEPLOY` marker is not an ordinary root-cause bootstrap marker.
Recovery autocontinue also did not dispatch a provider workflow; it returned
`R1_RECOVERY_DEPLOY_ATTEMPT_CHANGESET_INVALID`. Gate C stopped at authority preflight; readiness, OIDC,
Yandex CLI and provider deployment were skipped.

The single manual deploy-only run `36604866875` stopped at
`RECOVERY_DEPLOY_ATTEMPT_OWNER_MARKER_INVALID`. PR #872 used
`Regression-Test: tests/tooling/exact-source-artifact.test.mjs`, while the workflow requires the exact
canonical test `tests/tooling/initial-bootstrap-recovery-deploy-attempt-workflow.test.mjs`. The create
step remained `skipped`; CLI, OIDC, Function metadata and provider operations did not run. This distinct-
SHA prewrite stop did not consume the Owner's one-shot create.

History for failed recovery run `36341844854` now contains two deploy-only workflow runs,
`36590773848` and `36604866875`. The next exact-SHA deploy classifies **each** prior run independently:
exactly one deploy job and one create step with `conclusion=skipped` are required for every prior run.
Only when all prior stops on distinct SHAs are proven prewrite-only does the one-shot remain available.
Any create with `success`/`failure`/`cancelled`, same SHA, active run, or missing/duplicate/ambiguous
evidence blocks continuation. The next marker must use the canonical regression-test path above. No
same-SHA retry, Function invoke, IAM change, cleanup or YDB/Google action is authorized.

#### Self-run collision in exact-SHA preflight after PR #873

Deploy-only run `36609062283` на exact main `7013075d385667988ce49328fd0797b259bd91b3` прошёл prior-run
history classification, затем остановился с `RECOVERY_DEPLOY_ATTEMPT_ALREADY_USED_FOR_SHA`. Его
same-SHA API query включала только что dispatch-нутый текущий workflow run и сравнивала только
`head_sha`; поэтому сама эта попытка совпала с guard. Job evidence confirms create step `skipped`;
OIDC exchange, Yandex CLI, Function preflight и provider operation были skipped. Это доказанный
repository-side self-match, а не уже использованный create.

Следующий exact-SHA successor исключает из same-SHA query только `GITHUB_RUN_ID` текущего workflow.
Все остальные runs с тем же SHA остаются блокирующими; cross-SHA history по failed run по-прежнему
проверяет каждый exact attempt, job и create step. Для recovery `36341844854` три предыдущих SHA
(`099275d`, `2263cd9`, `7013075`) имеют exact create step `skipped`; следующий run допустим только на
новом SHA, с успешным canonical CI и marker на canonical regression test. Любой ранее достигнутый
create либо same-SHA replay блокирует попытку.

#### One read-only durable recovery using the accepted version after PR #874

The owner-authorized create-only run `36611387299` ended with
`RECOVERY_FUNCTION_VERSION_CREATE_ACCEPTED_NO_INVOKE`. This proves the provider accepted one immutable
recovery version; it does **not** classify YDB durable state or prove `COMMITTED`. The version was not
invoked as part of that one-shot authority, which is now consumed.

The next Incident-M adds a `reuse_deploy_attempt_run_id` mode to the canonical read-only recovery
workflow. It is available only from an exact merged R1 PR whose title identifies its still-open tracking
issue and whose body carries the marker below, on exact protected main with successful canonical CI.
Before Yandex access, the workflow proves the exact latest failed recovery run
(`36341844854`, deploy failed/invoke skipped), the exact successful source deploy-only run, its merged
one-shot authorization PR (#874), complete history for all prior attempts (exactly one reached
successful create, every earlier create skipped on a distinct SHA), and
the current recovery PR marker. Missing, duplicate, same-SHA, incomplete or conflicting history stops.

#### PR #875 read-only reuse preflight stop: dynamic Actions run name

PR #875 merged as exact main `399e762e697736e8cca30faf6ebc69b940e4bd99`; canonical CI `36641067886`,
Browser Quality `36641067884` and CodeQL `36641068161` all passed. Recovery autocontinue run
`36641163282` stopped before dispatch with `R1_RECOVERY_AUTOCONTINUE_REUSE_SOURCE_RUN_NOT_EXACT`.
No canonical recovery run was dispatched; Yandex version metadata, Function invoke and YDB were not
reached. The accepted version from `36611387299` remains uninvoked; durable state is still unknown.

Read-only GitHub Actions metadata confirmed the causal mismatch: for this workflow, API `name` is the
dynamic `run-name` (`R1 recovery-only deploy attempt for failed run 36341844854`), while workflow identity
is the numeric `workflow_id` from the workflow-file endpoint. Earlier history/source code compared the
dynamic value to the static workflow filename name, preventing source-run classification and potentially
omitting prior runs. Gate C run `36641163254` independently stopped at
`Verify one-shot Gate C repository authority`; readiness, provider, deployment and invoke steps were all
`skipped`.

The next single causal fix updates every recovery deploy attempt-history/source check to bind the exact
workflow-file endpoint and `workflow_id`, carries dynamic run-name/duplicate/missing/wrong-workflow cases
through synthetic fixtures, and preserves fail-closed history classification. It remains repository-only
until new-SHA exact-main CI and the complete reuse guards pass; no provider invoke or create is authorized
by this stop. The existing Owner anti-S-unit directive remains synchronized in `AGENTS.md` and
`docs/R1_COMPLETION_SPRINT.md` in the same causal PR.

After PR #876, exact-main run `36643931461` passed source-history, authorization, WIF and private-boundary
checks and performed only read-only Yandex Function version/operation/tag metadata reads. It stopped with
`INITIAL_BOOTSTRAP_RECOVERY_REUSE_VERSION_NOT_EXACT`; deployment and Function invoke were skipped, so
Google and YDB were not read. The then-current workflow supplied a synthetic empty tag-history document
and did not preserve the classifier sub-enum on failure. The next integrated Incident-M therefore adds
the existing exact recovery-tag-history request, a read-only Audit Trails/Cloud Logging provenance fallback
for operation-metadata candidate cases, and an enum-only artifact for every pre-invoke terminal outcome.
Only exact operation proof or exact actor/function/time/version audit proof bound to the active tag can
admit the one read-only invoke. All other classifier/source outcomes stop with no redeploy or invoke.

PR #877 merged as `42fceefea0a9d38997f6604dc1e73315ccef0649`; its exact-main CI, Browser Quality and CodeQL
passed. Recovery autocontinue run `36647818262` stopped at
`R1_RECOVERY_AUTOCONTINUE_REUSE_CHANGESET_INVALID` before issuing another recovery dispatch. The stopped
caller has a bounded interpretation: it was the exact PR-change-set gate, not provider or YDB activity.
Because that source main contains the failed recovery version-proof run `36643931461`, the integrated
successor preserves the exact deployment-failed/invoke-skipped source and validates the latest recovery
predecessor only. That predecessor is tolerated only when it is the exact distinct-SHA
version-proof-failed/deploy-skipped/invoke-skipped read-only stop. Any other latest predecessor blocks.

PR #878 merged as `8f8e3e8d0e6e5baff3999aa6777a2de405c7bf18`; exact-main CI `36651858133`, Browser
Quality `36651858153` and CodeQL `36651858180` passed. Its post-merge read-only autocontinue
`36651940080` stopped before recovery dispatch with `R1_RECOVERY_AUTOCONTINUE_REUSE_CHANGESET_INVALID`:
the marker and run identities were valid, but the source PR did not contain the full causal changeset
required by the main-branch guard. No recovery workflow was dispatched; no Yandex or YDB probe ran.
The successor stays in the same Incident-M boundary and pairs the exact run/job predicates in both
caller and recovery workflows with synthetic fixtures, then carries protobuf repeated-field empty
semantics through the terminal Audit Trails decision and synchronizes anti-drift process rules. It preserves the one-shot
create as consumed; only an exact-main/CI-approved read-only reuse classification can dispatch once.

After PR #879 merged as `86fd83e`, its exact-main recovery autocontinue `36656158010` stopped before
dispatch with `R1_RECOVERY_AUTOCONTINUE_REUSE_RECOVERY_HISTORY_INCOMPLETE`. The endpoint's broad
100-run response was already full; no recovery workflow/provider request started. The successor changes
the root model: read the exact failed source run by ID, then select only the latest predecessor from an
Actions server-side `created` window. Autocontinue uses a one-run page; the active recovery workflow
proves `[current run, latest predecessor]` on a two-run page. A source-only predecessor or one exact
distinct-SHA failed verification predecessor with deploy/invoke skipped proceeds; any other/missing/
ambiguous candidate is a terminal pre-provider STOP. The bounded query does not paginate; an unresolved
result closes this boundary rather than authorizing another history-detail refinement.

The reuse path never executes `Function version create`. After the regular private/trigger-free/identity
preflight, it reads the Function version list, operation list, exact recovery tag and bounded tag history;
it never substitutes a synthetic empty tag history for a provider read failure. Existing
`classifyRecoveryFunctionDeployOutcome` first checks exact operation/version/tag/runtime/entrypoint/runtime-SA
correlation within the successful deploy run's time window. If that metadata yields only a version candidate,
one already-contracted read-only Audit Trails → Cloud Logging path classifies the exact
`CreateFunctionVersion` event by actor, function, time and version. The event's version ID must match the
unique currently active recovery tag and the accepted runtime/entrypoint/runtime-SA. The source decision
must be `EXISTING_APPLICABLE_AUDIT_SOURCE`; absent, unsupported, changed-after-target, unusable or ambiguous
source/event evidence stops before invocation. No additional source aliases are invented.

The recovery workflow retains an enum-only proof artifact even when pre-invoke metadata classification
fails. It contains the version-classifier enum, bounded Audit Trails source-decision enum and audit-event
enum only; raw version, operation, trail, audit, provider or financial payload stays in runner-temp.
Only exact proof from either the operation-correlated path or corroborated audit-event path admits one
invocation of the existing write-free recovery handler. Missing, ambiguous, inactive, mismatched, untagged,
or temporally uncorrelated metadata stops before invocation and does not re-arm deployment. Exact main is
checked again immediately before invocation.

After PR #879, merge `86fd83e`'s read-only autocontinue `36656158010` stopped pre-dispatch with
`R1_RECOVERY_AUTOCONTINUE_REUSE_RECOVERY_HISTORY_INCOMPLETE`: broad completed-run history exceeded its
fixed 100-record page. No recovery child, Yandex request, Function invoke/deploy, Google or YDB access
occurred. The successor replaces the full scan with a different repository-side proof: `GET` the exact
failed source run, then query the server-side `created` window sorted newest-first. Autocontinue selects
one latest candidate; a running canonical recovery validates its own run as newest and selects exactly
one latest predecessor. Source-only means no intervening recovery; otherwise exactly one exact
distinct-SHA failed verification stop with deploy/invoke `skipped` is the sole tolerated predecessor.
Malformed source/query, missing source, failed latest-run identity/phase proof or an unsupported history
shape terminates before provider dispatch. The bounded query intentionally does not paginate; that terminal
outcome requires a root-cause model change, not pagination-only diagnostic cycles.

The repository-only API contract was verified read-only against the exact failed-run timestamp: the
server-side `created=<source>..*`, descending, two-entry query returned only the recognized latest
pre-invoke failure `36643931461` and exact source `36341844854` (`total_count=2`). This query does not read
Yandex/Google/YDB state and cannot authorize version create or recovery invoke on its own.

The bounded outcomes have different next steps:

- Exact version proven and read-only recovery returns `NOT_APPLIED / EMPTY_DURABLE_STATE`: continue only
  through the applicable fresh recovery/readiness/bootstrap root-cause gates.
- Read-only recovery returns `RECOVERY_REQUIRED` plus exact STAGING/VALIDATED evidence: choose the
  already applicable resume, source-drift retirement or stale-VALIDATED Gate C path; no inference or
  generic replay.
- Recovery returns `APPLIED` or `NOT_APPLIED`: treat these as recovery-specific verdicts, then use the
  exact applicable stage contract. Neither verdict alone proves R1 `COMMITTED`; run independent
  reconciliation and catch-up review before claiming a baseline.
- Version source cannot be proven: no invoke and no redeploy under the consumed one-shot; the enum-only
  artifact identifies whether operation metadata, tag history or the existing audit-source branch is
  missing/ambiguous, then select the corresponding next root-cause model without a discriminator-only PR.
- Read-only invoke/classification fails: no replay or cleanup; fix the specific repository/read-path
  cause before another read-only cycle.

This reuse flow performs no YDB application writes, schema changes, IAM mutation, timer/cutover or
authority switch. Raw provider/financial payload remains private. The marker is:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Recovery-Run-ID: 36341844854
Recovery-Version-Run-ID: 36611387299
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

The reuse marker is a read-only `STAGING_PRESENT_UNCLASSIFIED` probe, not a create re-arm. Recovery
autocontinue additionally proves that the named accepted-version source run is the successful, exact,
one-shot deploy-only attempt for the same failed recovery run, and passes that run ID and the exact merged
read-only PR number to the canonical recovery workflow. The workflow repeats all gates and the source PR
marker checks; direct unmarked dispatch cannot select reuse mode. It also requires canonical current-main
CI/artifact and latest failed bootstrap/recovery phase evidence.

The successful source run's version metadata is checked in its exact bounded run window: Function version
list, create operations and `get-by-tag` must identify one active
`index.initialBootstrapRecoveryHandler` on the dedicated runtime service account and exact recovery tag.
Only the unique `EXACT_RECOVERY_VERSION_CREATED` classification allows the tag invoke. The deploy step is
explicitly `skipped` in reuse mode; all other classifier results end before invocation and cannot re-arm
the consumed create. The handler package is the previously accepted read-only package; no schema or
application writer path is included.

For this path the marker carries two distinct run identities: `Recovery-Run-ID` binds the previously
failed recovery attempt; `Recovery-Version-Run-ID` binds the later successful create-only run. They are
not interchangeable. The recovery PR must also include the caller workflow, reuse-mode recovery workflow,
the source-history test and this runbook. The exact marker is:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Recovery-Run-ID: 36341844854
Recovery-Version-Run-ID: 36611387299
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

### Recovery autocontinue exact phase-predicate correction after #880

On exact main `78893a3cff86b3e7b352e5fc1c8f5b7805cb27be`, recovery autocontinue run
`36661175672` reached the reuse source phase check but its shell referenced unset `failed_jobs`
instead of the fetched exact response `source_failed_jobs`. Under `set -u` this produced
`R1_RECOVERY_AUTOCONTINUE_REUSE_FAILED_PHASE_NOT_PROVEN` before dispatch. The same SHA's Gate C run
`36661175607` independently stopped at `GATE_C_PR_AUTHORITY_MARKER_INVALID`; readiness, deployment,
invoke and provider authentication steps were skipped. No Yandex/Google/YDB request or provider state
mutation occurred.

The successor corrects the response binding and adds jq fixtures for a unique exact failed deploy with
skipped invoke, wrong conclusion/phase, absent or duplicate recovery jobs, and duplicate phase steps.
The decision remains terminal: only one exact matching job/phase advances to the existing bounded
latest-predecessor and reuse-source gates; false, missing, duplicate, or malformed evidence stops before
dispatch. If every downstream exact gate passes, the only authorized continuation remains the single
read-only exact revision classification for failed run `36341844854` using accepted version run
`36611387299`; any mismatch remains UNKNOWN and no create, invoke, replay, cleanup, or authority change
is inferred.

Local Windows Node 22 verification normalizes workflow fixture line endings before extracting jq
predicates; this keeps the paired recovery/caller fixtures equivalent to the Linux CI source text.

### Terminal Audit-source evidence and exact-folder source bypass after #881

On exact main `7012c9ee9bffacce0bbe153ca05501b4d5fdadc4`, the single canonical read-only reuse recovery
`36663137154` passed exact failed-run, accepted deploy-run, source-PR marker and private Function gates.
It read Function version/operation/tag metadata and the Audit Trails source, then published only the
enum artifact `r1-initial-bootstrap-recovery-reuse-evidence-36663137154`:

```text
recoveryVersionReuse=RECOVERY_REUSE_VERSION_NOT_PROVEN
versionMetadataEvidence=CREATED_VERSION_NOT_PROVEN
operationListEvidence=RECOVERY_REUSE_OPERATION_LIST_READ
tagHistoryEvidence=RECOVERY_REUSE_TAG_HISTORY_READ
auditTrailEvidence=AUDIT_TRAIL_TARGET_FOLDER_NOT_FOUND
auditSourceDecision=SOURCE_EVIDENCE_UNUSABLE
auditCreateEventEvidence=AUDIT_EVENT_READ_NOT_ATTEMPTED
```

Function/Lockbox gates had already validated the exact configured target folder, but Cloud-wide
`ListFolders` did not return it. This proves the inventory prerequisite unusable for this target; it
does not prove that no Audit Trail exists or whether the one-shot Function-version create applied.
The source branch outcome is terminal `SOURCE_EVIDENCE_UNUSABLE`; no more folder-inventory enums are
authorized. Recovery Function create/deploy/invoke were skipped; no Google/YDB read/write, replay,
cleanup, or authority change occurred.

The causal successor changes the lookup model: both recovery reuse and deploy-recovery query the
existing Audit Trails `List` endpoint directly for the exact `YC_FOLDER_ID` already proven by Function
and Lockbox metadata, avoiding Cloud-wide folder inventory. It binds each returned trail to the exact
folder and cloud and keeps pagination/malformed response proof fail-closed. Synthetic fixtures cover
the decision end-to-end: a unique applicable pre-existing Cloud Logging source allows only exact event
correlation; empty trails—including omitted `trails` under ProtoJSON—end as
`NO_APPLICABLE_PREEXISTING_AUDIT_SOURCE`; malformed, paginated, mismatched or ambiguous evidence ends
as `SOURCE_EVIDENCE_UNUSABLE/AMBIGUOUS`. Only exact applicable source plus unique exact event can
classify the accepted Function version; no such result authorizes another create, invoke, replay,
cleanup, or authority change.

### Exact-folder Audit Trails permission denial and one-shot reader authorization

On exact main `dcbd54c8ed12ad739b22910ac9e9938e4a332634`, canonical read-only recovery `36667055740`
passed the exact failed-run and source-run gates, confirmed the private Function boundary, then the
direct exact-folder `TrailService.List` returned `AUDIT_TRAIL_LIST_PERMISSION_DENIED`. Its enum-only
artifact reported `RECOVERY_REUSE_VERSION_NOT_PROVEN`, `CREATED_VERSION_NOT_PROVEN` and
`SOURCE_EVIDENCE_UNUSABLE`; version/operation/tag reads were metadata-only, and deploy/invoke were
skipped. No Google/YDB access or Function mutation occurred. The direct folder bypass is correct, but
the WIF principal currently lacks `audit-trails.viewer` at that folder.

The next causal PR may arm one temporary read-only permission attempt only from the exact marker:

```text
Provider-Attempt: READY
Observed-Signature: INITIAL_BOOTSTRAP_RECOVERY_REUSE/AUDIT_TRAIL_LIST_PERMISSION_DENIED/SOURCE_EVIDENCE_UNUSABLE
Expected-Transition: TEMPORARY_AUDIT_SOURCE_READ_AND_CLASSIFY
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Circuit-Rearm: ROOT_CAUSE_FIX
Authority-Scope: TEMPORARY_AUDIT_VIEWER_AT_EXACT_FOLDER_AND_LOGGING_READER_AT_EXACT_CLOUD_LOG_GROUP
Recovery-Run-ID: 36341844854
Recovery-Version-Run-ID: 36611387299
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

The workflow must read the exact existing binding set first. It may add `audit-trails.viewer` only at
the exact Function folder if the WIF binding is absent; if one unique Cloud Logging destination is then
proven, it may add `logging.reader` only at that exact group if absent. Existing bindings are never
removed. Any role added by this run is removed after classification and independently verified absent;
malformed/duplicate bindings, denied/failed grant, incomplete metadata, or unproven retirement stop the
run without further event reads or Function invoke. Permission denial after the single bounded attempt
ends this authority hypothesis; do not widen scope or cycle through more IAM enums. Function create,
redeploy, bootstrap replay, Google/YDB writes, cleanup of staging, and authority switches remain forbidden.

The permission-rearm PR uses this exact marker, bound to the latest privacy-safe denial artifact and
the original accepted create-only version:

```text
Provider-Attempt: READY
Observed-Signature: INITIAL_BOOTSTRAP_RECOVERY_REUSE/AUDIT_TRAIL_LIST_PERMISSION_DENIED/SOURCE_EVIDENCE_UNUSABLE
Expected-Transition: TEMPORARY_AUDIT_SOURCE_READ_AND_CLASSIFY
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Circuit-Rearm: ROOT_CAUSE_FIX
Authority-Scope: TEMPORARY_AUDIT_VIEWER_AT_EXACT_FOLDER_AND_LOGGING_READER_AT_EXACT_CLOUD_LOG_GROUP
Recovery-Run-ID: 36341844854
Recovery-Version-Run-ID: 36611387299
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

The canonical recovery workflow accepts this `READY` marker only with the explicit permission-probe
input and exact merged source PR. Recovery autocontinue validates the IDs/history/source changeset and
dispatches only that workflow. Other R1 autocontinue paths do not accept this source-permission
signature; duplicate/ambiguous marker lines fail closed.

### Exact reuse preflight stopped before the temporary Audit-source permission path

On exact main `0dac36920088f4c290fcda8e4d6260d20de105f0`, recovery run `36697361841` failed at
`Verify exact accepted recovery Function version for reuse` with the safe signature
`INITIAL_BOOTSTRAP_RECOVERY_REUSE_VERSION_NOT_EXACT`; deploy and invoke were `skipped`. The enum-only
artifact was missing because the EXIT cleanup referenced an uninitialized temporary logging-reader flag.
The exact checked-in control flow exits at version proof before temporary IAM setup, Audit Trails, Cloud
Logging, Function deploy/invoke, or YDB recovery invoke. No cleanup or IAM mutation is inferred.

One exact-run full read-only classification is allowed on a new SHA, bound to failed recovery run
`36697361841` and the earlier accepted version source run `36611387299`:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Recovery-Run-ID: 36697361841
Recovery-Version-Run-ID: 36611387299
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

The exact failed phase is accepted only when reuse verification failed and both deploy/invoke were
skipped; the pre-existing deploy-failed/invoke-skipped phase remains separately supported. The probe
does not add/remove IAM bindings or create a Function version. It classifies version provenance and
continues only through the existing read-only Audit-source/recovery gates. Exact applicable source,
`NO_APPLICABLE_PREEXISTING_AUDIT_SOURCE`, and `SOURCE_EVIDENCE_UNUSABLE/AMBIGUOUS` have distinct terminal next steps; a
still-unproven version stops before Audit-source/IAM access and changes the provenance root-cause
hypothesis. Same-SHA/run-ID replay, cleanup, permission widening, create, and YDB replay remain forbidden.

### Distinct target, version-source, and classification run IDs after `REUSE_SOURCE_RUN_NOT_EXACT`

On exact main `78e5b09d65b39c8b5607335c3595730894ff345f`, recovery autocontinue run `36702973467`
stopped before dispatch with `R1_RECOVERY_AUTOCONTINUE_REUSE_SOURCE_RUN_NOT_EXACT`. PR #884 incorrectly
put failed verification run `36697361841` into `Recovery-Run-ID`; the successful version-source run
`36611387299` was created for original target failed recovery run `36341844854`. No recovery workflow or
Yandex/YDB provider request followed this caller-only stop; durable state remains UNKNOWN.

The next `NOT_AUTHORIZED` read-only marker binds all three exact identities:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Recovery-Run-ID: 36341844854
Recovery-Version-Run-ID: 36611387299
Recovery-Classification-Run-ID: 36697361841
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

The target ID remains the original failed recovery with deploy failed/invoke skipped. Since the target
run predates the reuse-verification step, its step may be absent or the unique step may be `skipped`; a
duplicate or failed verification step blocks. The accepted version-source ID remains bound to that
target. The classification ID is only the latest source-relative failed reuse-verification preflight,
with deploy and invoke skipped. Caller and canonical
recovery independently require the classification ID to equal the exact latest predecessor and verify
its job/step phase. Missing, mismatched, duplicate or intervening run evidence stops before dispatch.
Terminal read-only outcomes remain: applicable exact source → existing recovery only; no applicable
pre-existing source → stop this Audit-source branch and change causal model; unusable/ambiguous → STOP;
version provenance still unproven → stop before Audit-source/Function/YDB access. No temporary IAM,
deploy, replay, cleanup or authority change is armed.

### Exact-folder permission rearm after recovery `36709073723`

On exact main `0c402cae1231ebcf9f98438d48b1893e9925e16c`, the corrected identity-bound full read-only
recovery `36709073723` published the enum-only artifact
`r1-initial-bootstrap-recovery-reuse-evidence-36709073723`:

```text
recoveryVersionReuse=RECOVERY_REUSE_VERSION_NOT_PROVEN
versionMetadataEvidence=CREATED_VERSION_NOT_PROVEN
operationListEvidence=RECOVERY_REUSE_OPERATION_LIST_READ
tagHistoryEvidence=RECOVERY_REUSE_TAG_HISTORY_READ
auditTrailEvidence=AUDIT_TRAIL_LIST_PERMISSION_DENIED
auditViewerBindingEvidence=RECOVERY_REUSE_TEMP_AUDIT_VIEWER_NOT_REQUESTED
loggingReaderBindingEvidence=RECOVERY_REUSE_TEMP_LOGGING_READER_NOT_REQUESTED
bindingRetirementEvidence=RECOVERY_REUSE_TEMP_AUDIT_BINDINGS_NOT_REQUIRED
```

The source branch has now reached a deterministic exact-folder permission denial after unique folder/cloud
query; this is the source decision for the permission hypothesis. One Incident-M may request exactly one
temporary `audit-trails.viewer` binding at the exact Function folder, and only after a unique pre-existing
Cloud Logging destination is proven, one `logging.reader` binding at that exact group. The current role
binding pre-state must be absent before each add; post-add read-back must be exact. Cleanup may remove only
bindings this run added and independently prove them absent. Existing permissions are preserved.

```text
Provider-Attempt: READY
Observed-Signature: INITIAL_BOOTSTRAP_RECOVERY_REUSE/AUDIT_TRAIL_LIST_PERMISSION_DENIED/SOURCE_EVIDENCE_UNUSABLE
Expected-Transition: TEMPORARY_AUDIT_SOURCE_READ_AND_CLASSIFY
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Circuit-Rearm: ROOT_CAUSE_FIX
Authority-Scope: TEMPORARY_AUDIT_VIEWER_AT_EXACT_FOLDER_AND_LOGGING_READER_AT_EXACT_CLOUD_LOG_GROUP
Recovery-Run-ID: 36341844854
Recovery-Version-Run-ID: 36611387299
Recovery-Classification-Run-ID: 36709073723
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

Terminal outcomes differ: unique applicable pre-existing Cloud Logging source + unique exact create event
and version metadata permits only the existing single read-only recovery invoke after verified cleanup;
no applicable source ends this branch and changes causal model; unusable/ambiguous source, binding state,
read-back, event correlation, or retirement evidence ends STOP with invoke skipped. No widening, retry,
Function create/deploy, bootstrap replay, or inferred cleanup is allowed.

### Alternate exact recovery-version proof from CreateFunctionVersion operation metadata

On exact main `b05ae9696b9a5c5dc60b865b73129e439a98a344`, recovery `36713248229` failed at
`Verify exact accepted recovery Function version for reuse`; deploy and invoke were skipped. Its enum-only
artifact reported `RECOVERY_REUSE_VERSION_NOT_PROVEN / CREATED_VERSION_NOT_PROVEN`, and the independent
Owner read-only source classification reached terminal `NO_APPLICABLE_PREEXISTING_AUDIT_SOURCE`. The
Audit-source and temporary permission branches are therefore closed for this target.

The Yandex Cloud API contract offers an independent proof already present in the exact Function operation
list: `CreateVersion` returns an operation whose metadata type is
`CreateFunctionVersionMetadata`, with the ID of the version being created in `function_version_id`;
successful `response` is a `Version` with `id`. The new causal hypothesis is that the existing classifier
requires only `response.id` and discards the operation's typed resource identity. Recovery may use metadata
ID only when all of these agree: unique completed, error-free create operation by the expected actor in
the accepted version run's bounded time window; exact documented metadata type and a single consistent
version ID; optional response ID agrees; exactly one same-window version-list record has that ID and
recovery tag; and the active tag lookup has the same ID with exact runtime, entrypoint and runtime service
account. ProtoJSON `functionVersionId` and the Yandex CLI's protobuf `function_version_id` encoding are
both covered; conflicting aliases, wrong `@type`, unknown fields, empty ID, duplicate operations/versions,
wrong tag/configuration or incomplete lists remain unproven. No raw operation/version payload or IDs enter
artifacts.

The exact successor marker is one full read-only recovery classification, bound to original failed target
`36341844854`, accepted create-only source `36611387299`, and latest failed reuse-classification
`36713248229`:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Recovery-Run-ID: 36341844854
Recovery-Version-Run-ID: 36611387299
Recovery-Classification-Run-ID: 36713248229
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

Distinct terminal actions are required: exact metadata/version/tag/configuration proof skips Function
create and every Audit/IAM query, then permits exactly one existing write-free recovery invoke for
durable-state classification; absent, malformed, conflicting or ambiguous proof publishes enum-only
evidence and leaves deploy/invoke skipped with state UNKNOWN. The second outcome does not authorize
another provenance discriminator, permission attempt, deployment, cleanup or replay. Even a successful
classification does not itself prove `COMMITTED`; follow its state-specific gates and independent YDB
reconciliation. Full API shape, malformed/oneof/conflict cases, and terminal transitions are synthetic
fixtures in this one Incident-M, alongside exact caller/canonical failed-run and source-history guards.
For the observed `CREATED_VERSION_NOT_PROVEN` signature, invalid/missing typed metadata also stops before
Audit Trails/IAM fallback so the already-terminal source branch is not replayed.

### PR #888 recovery autocontinue stopped before provider on the exact changeset guard

On exact main `4d59cb8af731c37b25f2661c5ae24be3863cc00f`, CI `36730652859`, Browser Quality
`36730653007`, and CodeQL passed after PR #888. Recovery autocontinue `36730770276` read and validated
its exact marker/run identities, then stopped with `R1_RECOVERY_AUTOCONTINUE_REUSE_CHANGESET_INVALID`:
the marker named `tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs`, which was
not included in PR #888's changed files. No `R1 initial bootstrap recovery` run was dispatched, no
Yandex query occurred, and no Function/YDB invoke or mutation happened. This gate failure does not
consume a provider classification attempt or change the last exact recovery predecessor `36713248229`.

The successor remains the same Incident-M and keeps the exact marker/run identities above. Its complete
changeset includes the named autocontinue regression test, canonical recovery workflow and regression
test, caller workflow test, runbook, `AGENTS.md`, and completion sprint docs. The fixture verifies the
typed metadata decision and every matched-operation fail-closed exit before Audit/IAM fallback; the
autocontinue fixture verifies exact failed-phase/source identities and the required regression file is
part of the merged PR before dispatch. Expected terminal outcomes remain exact guarded read-only recovery
dispatch or pre-provider STOP with no provider calls. Do not manually dispatch, alter the marker/run IDs,
retry this SHA, or infer provider activity from autocontinue success.

### Exact OperationService.Get provenance bypass after recovery `36734338396`

The approved typed-metadata/ListOperations classification run `36734338396` on exact main
`c86aa0a831c7cf413aed4f432a706e39ad746dc5` completed failure at reuse version verification with
`RECOVERY_REUSE_VERSION_NOT_PROVEN / CREATED_VERSION_NOT_PROVEN`; deploy/invoke and Audit/IAM fallback
were skipped. This is terminal for the ListOperations response source; no same-source replay or extra
enum refinement is allowed.

The new read-only root model queries a different Yandex Cloud resource endpoint:
[OperationService.Get](https://github.com/yandex-cloud/cloudapi/blob/master/yandex/cloud/operation/operation_service.proto).
It first selects one Operation ID from the already-read exact Function-scoped list only if actor/time match
the successful create-only source run and the operation is unique, done, error-free and has a response. It
GETs that exact ID with the existing WIF token, then requires returned Operation.id to match, the typed
`CreateFunctionVersionMetadata.function_version_id` to be exact, any Version response ID to agree, and the
version list/current tag to identify one active runtime-contract-matching recovery version. Selection ID
is runner-temporary and API payload remains private; only enum evidence is uploaded. Selection/Get errors,
duplicates, wrong ID/type, incomplete/malformed operation, or version/tag/config mismatch all stop before
Audit/IAM/deploy/invoke. Exact proof permits only the existing single write-free recovery invoke.

The one-shot full read-only classification stays bound to failed target `36341844854`, accepted version
source `36611387299`, and exact latest failed reuse verification `36734338396`:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Recovery-Run-ID: 36341844854
Recovery-Version-Run-ID: 36611387299
Recovery-Classification-Run-ID: 36734338396
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

Terminal actions differ: exact Get/list/version/tag agreement → one durable read-only classification;
missing/ambiguous/error/mismatch → remain UNKNOWN, no invoke/redeploy/cleanup/replay and stop this proof
path. A successful recovery classification still does not prove `COMMITTED` without independent YDB
reconciliation. This is a distinct resource provenance bypass, not another refinement of ListOperations.

### Exact successful create-step + immutable tag history after recovery `36739560248`

The distinct `OperationService.Get` attempt on exact main
`4da687ef15d718020cbb404df7417e371aeaa11f` reached the same terminal
`RECOVERY_REUSE_VERSION_NOT_PROVEN / CREATED_VERSION_NOT_PROVEN`; deploy/invoke remained skipped and no
IAM/Google/YDB write occurred. That closes Operation list/Get response provenance for this version.

The successor root model no longer asks Yandex Operation metadata which version was created. GitHub run
`36611387299` is already the exact accepted create-only source for failed target `36341844854`; its job
`deploy-only-attempt` has exactly one successful step
`Create exactly one read-only recovery Function version without invoking it`. The step ran from
`2026-09-29T18:21:37Z` through `2026-09-29T18:22:02Z`. Those step timestamps, not the wider workflow
window, define the source observation.

Read-only provider proof must agree on all of the following before any Function invoke:

- one version-list row with recovery tag and `created_at` inside the exact step window;
- `GetVersionByTag` returns that same active version ID and the complete create-only runtime fingerprint:
  `nodejs22`, `index.initialBootstrapRecoveryHandler`, exact runtime service account, 1 GiB, 150 s,
  three recovery mode env flags set to `0`, no logging, expected metadata options and the five exact
  Lockbox environment/key mappings;
- `ListTagHistory` has exactly one recovery-tag assignment to the same `functionVersionId` with
  `effectiveFrom` inside the same step window. Workflow captures `observedAt` after the provider reads
  and requires the history interval to be active at that moment:
  `effectiveFrom <= observedAt < effectiveTo`; no later assignment is allowed.

This proof intentionally does not read Function Operations, `OperationService.Get` or Audit Trails.
Exact agreement permits only the existing one write-free recovery invoke; missing/ambiguous/time/config/
history divergence fails closed before invoke. It does not authorize create/redeploy/IAM mutation,
cleanup, bootstrap replay, timer, cutover or any Google/YDB write.

The original #891 successor marker was:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Recovery-Run-ID: 36341844854
Recovery-Version-Run-ID: 36611387299
Recovery-Classification-Run-ID: 36739560248
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

### Active tag-history interval correction after recovery `36755191147`

PR #891 merged the source-step proof on exact main
`b17e8951f279b4f3609d2f7b080d63860699f984`. Guarded recovery `36755191147` reached
`Verify exact accepted recovery Function version for reuse` and stopped fail-closed; deploy and invoke
were skipped, Operation/Audit paths were not read, and no IAM/Google/YDB write occurred.

A fresh Owner-authenticated read-only provider reconciliation localized the mismatch without exposing
resource IDs or financial data. Every version fingerprint invariant matched the create-only contract:
active status, runtime/entrypoint/service account, recovery tag, 1 GiB, 150 s, exact three recovery env
flags, no logging, metadata options, five Lockbox mappings, one version-list candidate and
`createdAt=2026-09-29T18:21:40.841Z` inside the exact source-step window. The matching tag-history record
also points to the same function/version/tag with
`effectiveFrom=2026-09-29T18:22:01.556Z`, but Yandex returns
`effectiveTo=2099-12-31T23:59:59Z` for that still-active mapping.

The failed classifier incorrectly required `effectiveTo` to be absent. Yandex API defines
`effectiveTo` as the timestamp when the tag stops being active, so a future value is an active interval,
not retirement. The bounded correction therefore records `observedAt` after reading tag history and
accepts only `effectiveFrom <= observedAt < effectiveTo`, while still rejecting malformed/expired
intervals and any later assignment. This is a correction inside the same source-step/tag-history causal
model, not a new provider discriminator.

The exact successor marker is:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Recovery-Run-ID: 36341844854
Recovery-Version-Run-ID: 36611387299
Recovery-Classification-Run-ID: 36755191147
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

Exact active-interval agreement permits only the existing write-free recovery invoke. Any mismatch keeps
durable state UNKNOWN and stops before invoke; no create/redeploy/IAM mutation/cleanup/replay is armed.

### Repository-native pre-write orchestrator preflight after recovery `36761995601`

Recovery `36761995601` on exact main
`1110c84e71999b710c888fea0ad0a0416dbf6858` successfully completed the accepted-version proof and
single read-only recovery invoke. It returned
`PASS / INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED / RECOVERY_REQUIRED / STAGING_RUN_PRESENT` with fresh
privacy-safe diagnostics including `AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH`,
`COMPLETE_CURRENT_RUN_ONLY`, `STALE_STAGING_CURRENT_STATE_EMPTY`, source decode `NONE`, and
`EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN`. No `COMMITTED` baseline was proven.

PR #893 then removed the historical tracking-Issue number from ordinary autocontinue and exact-main CI
on `3a9a7d0d3aa637c967644029e3da52443b198a6d` passed. The remaining canonical step before any
`SOURCE_DRIFT_REBASE` is still one pre-write orchestrator run with both staging authority flags false.
That run exists only to reproduce the exact orchestrator-level
`R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED/RECOVERY_REQUIRED/STAGING_RUN_PRESENT` signature before
readiness/bootstrap.

The stage-specific autocontinue marker for this step is:

```text
Provider-Attempt: NOT_AUTHORIZED
Orchestrator-Preflight: READY
Observed-Recovery: INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED/RECOVERY_REQUIRED/STAGING_RUN_PRESENT
Expected-Transition: R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED/RECOVERY_REQUIRED/STAGING_RUN_PRESENT
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Recovery-Run-ID: 36761995601
Regression-Test: tests/tooling/r1-initial-bootstrap-autocontinue-workflow.test.mjs
```

Autocontinue validates that exact recovery run, its successful read-only invoke, the enum-only recovery
artifact, ancestor relation to the new source SHA, and a process-only changeset. It then dispatches the
orchestrator with `allow_staging_resume=false` and `allow_stale_staging_retirement=false`. Any
evidence mismatch stops before dispatch. This marker does **not** authorize stale retirement, resume,
readiness, bootstrap, cleanup, timer, cutover, Google mutation or YDB financial writes.

After the preflight completes, only an exact recovery-blocked signature plus fresh digest-mismatch/current-
empty evidence may arm a separate `Recovery-State: STAGING_STALE_RETIREABLE /
Circuit-Rearm: SOURCE_DRIFT_REBASE` successor.

### Exact CI run handoff after preflight `36765633980`

PR #895 merged the repository-native preflight surface on exact main
`8eba3ae4de7ddd0078482e7916ed3bd82cb34132`. Its push CI `36765501292` completed successfully,
and autocontinue proved the exact prior recovery `36761995601` before dispatching orchestrator
`36765633980` with both `allow_staging_resume=false` and
`allow_stale_staging_retirement=false`.

The orchestrator stopped **before any Yandex/provider action** at
`Restore verified exact-source artifact`. The composite action emitted
`R1_EXACT_SOURCE_CI_NOT_UNIQUE`; every YC/OIDC/recovery/readiness/bootstrap step was skipped. The
general Actions state for the source SHA exposed the successful push CI, so this failure is treated as
repository-side exact-CI rediscovery ambiguity, not as provider/durable-state evidence. No retirement,
resume, bootstrap, cleanup or financial write occurred.

Autocontinue already receives the exact successful CI identity as
`github.event.workflow_run.id`. The successor therefore carries that ID through
autocontinue → orchestrator `ci_run_id` → `restore-exact-source`. The restore action reads that exact
run and validates it with `scripts/classify-github-ci-run.mjs` against the source SHA before downloading
`r1-exact-source-<sha>`. Its existing bounded CI-list selector remains only as a manual-path fallback
when no explicit CI run ID is provided.

Because `36765633980` stopped before provider access, the same stage-specific preflight authority may
continue only on a **new exact SHA** after this repository fix. The marker remains:

```text
Provider-Attempt: NOT_AUTHORIZED
Orchestrator-Preflight: READY
Observed-Recovery: INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED/RECOVERY_REQUIRED/STAGING_RUN_PRESENT
Expected-Transition: R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED/RECOVERY_REQUIRED/STAGING_RUN_PRESENT
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Recovery-Run-ID: 36761995601
Regression-Test: tests/tooling/r1-initial-bootstrap-autocontinue-workflow.test.mjs
```

Success means only reaching the orchestrator-level recovery-blocked signature before readiness/bootstrap.
Any exact-source or recovery mismatch remains STOP; `SOURCE_DRIFT_REBASE` is still not armed by this
checkpoint.

### Exact source-drift rebase gate after preflight `36767291650`

PR #896 merged the exact CI run handoff on exact main
`866e62a176daf2a873a37bdfe16b19960be4b165`. Push CI `36767139596` passed and published the
exact-source artifact. Autocontinue `36767256576` proved the prior full recovery, carried that exact
CI run ID into the orchestrator and dispatched preflight `36767291650` with
`allow_staging_resume=false` and `allow_stale_staging_retirement=false`.

The preflight restored the exact-source artifact successfully, passed exact-main/provider boundaries,
deployed only the dedicated read-only recovery version, and stopped at its initial durable-state
classification. Readiness and bootstrap were not dispatched. Privacy-safe evidence from this exact run:

- orchestrator signature:
  `R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED / RECOVERY_REQUIRED / STAGING_RUN_PRESENT`;
- `R1_STAGING_REVISION_EVIDENCE=AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH`;
- `R1_STAGING_DURABLE_REVISION_EVIDENCE=COMPLETE_CURRENT_RUN_ONLY`;
- `R1_STAGING_RETIREMENT_EVIDENCE=STALE_STAGING_CURRENT_STATE_EMPTY`;
- `R1_STAGING_SOURCE_DECODE_EVIDENCE=NONE`;
- `R1_STAGING_EXACT_REVISION_EVIDENCE=EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN`;
- readiness run: none;
- bootstrap run/invoke: none.

This is the canonical pre-write source-drift boundary. It is not a failed root-cause bootstrap attempt
and does not authorize controlled rebuild, cap increase, ambiguous cleanup, timer or cutover. On one
new exact SHA, the stage-specific `SOURCE_DRIFT_REBASE` may arm only the existing orchestrator with
ordinary staging resume disabled and stale-STAGING retirement enabled. The provider path must repeat
fresh recovery, require the same safe retirement conditions, then pass fresh readiness before any
write-capable bootstrap child.

The successor marker is:

```text
Provider-Attempt: READY
Observed-Signature: R1_BOOTSTRAP_ORCHESTRATOR_RECOVERY_BLOCKED/RECOVERY_REQUIRED/STAGING_RUN_PRESENT
Expected-Transition: INITIAL_BOOTSTRAP_COMMITTED
Recovery-State: STAGING_STALE_RETIREABLE
Circuit-Rearm: SOURCE_DRIFT_REBASE
Regression-Test: tests/tooling/r1-initial-bootstrap-autocontinue-workflow.test.mjs
```

Any changed recovery signature, non-empty verified current, ambiguous durable evidence, failed
retirement/read-back, readiness non-PASS, bootstrap non-success or unknown provider outcome remains a
recovery boundary. Google stays authoritative until a separately proven COMMITTED shadow baseline and
required independent reconciliation/catch-up.

### Fresh durable classification after source-drift rebase bootstrap `36768370208`

PR #897 merged the exact source-drift rearm on main
`874879d1cfc4b19ddbdaba8117d0d6cc710ecb2e`. Exact-main CI `36767899771` and Browser Quality
`36767900016` passed. Autocontinue `36768010215` dispatched orchestrator `36768088603` with
ordinary staging resume disabled and stale-STAGING retirement enabled.

The orchestrator re-established the fresh recovery boundary, observed
`AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH + COMPLETE_CURRENT_RUN_ONLY +
STALE_STAGING_CURRENT_STATE_EMPTY`, armed only stale-STAGING retirement, completed its retirement
path, then required fresh readiness. Readiness `36768236046` passed before the orchestrator dispatched
exactly one write-capable initial bootstrap child `36768370208`.

The bootstrap child passed every pre-invoke gate, deployed the exact private trigger-free Function
version with `execution-timeout=600s`, and re-verified exact current main immediately before the
financial shadow invocation. The invoke began at approximately `2026-09-30T19:50:42Z` and the caller
returned about 301 seconds later with the privacy-safe terminal:

```text
FAIL / INITIAL_BOOTSTRAP_INVOKE_FAILED
```

The child therefore finished non-successfully. Orchestrator did not replay it. Its mandatory immediate
post-invoke read-only recovery completed at approximately `2026-09-30T19:56:20Z` and still reported:

```text
PASS / INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED
RECOVERY_REQUIRED / STAGING_RUN_PRESENT
R1_STAGING_REVISION_EVIDENCE=AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH
R1_STAGING_DURABLE_REVISION_EVIDENCE=COMPLETE_CURRENT_RUN_ONLY
R1_STAGING_RETIREMENT_EVIDENCE=STALE_STAGING_CURRENT_STATE_EMPTY
R1_STAGING_SOURCE_DECODE_EVIDENCE=NONE
R1_STAGING_EXACT_REVISION_EVIDENCE=EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN
```

This early post-invoke recovery is not sufficient to infer the final durable outcome: the Function
version itself allows execution for up to 600 seconds, so a lost caller transport does not prove that
server-side execution stopped at the same instant. The write outcome therefore remains UNKNOWN until a
fresh read-only classification is performed only after the maximum execution window has elapsed. No
same-SHA replay, retirement, resume, cleanup, readiness, bootstrap, timer, cutover or authority change is
authorized from the early recovery.

The next new-SHA successor is read-only only:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_DURABLE_CLASSIFICATION
Recovery-State: UNKNOWN_AFTER_NON_SUCCESS
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

Autocontinue may dispatch only `r1-initial-bootstrap-recovery.yml` with `surface_only=true`.
If that fresh classification proves a terminal applied/committed state, follow the corresponding
independent reconciliation path. If it returns only
`RECOVERY_REQUIRED / STAGING_RUN_PRESENT`, a separate new-SHA full read-only exact-revision
classification is required before any causal transport fix or later write. Any unknown/ambiguous result
remains a recovery boundary. Google stays authoritative and the first verified `COMMITTED` shadow
baseline is still not proven by this checkpoint.

### Full exact-revision classification after surface recovery `36770022601`

PR #898 merged the post-invoke durable-state checkpoint on exact main
`41d7f988ed73e55e97eabb624a4f1d0f2aafb321`. Push CI `36769871707` passed and recovery
autocontinue `36769984568` dispatched exactly one recovery run `36770022601` with
`surface_only=true` after the prior bootstrap Function's 600-second execution window had elapsed.

The surface recovery completed successfully. Its recovery Function was private and trigger-free, the
read-only invoke succeeded, and its privacy-safe classification was:

```text
PASS / INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED
RECOVERY_REQUIRED / STAGING_RUN_PRESENT
```

No financial bootstrap, readiness, resume, stale retirement, cleanup or authority switch was dispatched
from this successor. The result does not prove a `COMMITTED` baseline and surface-only mode does not
carry enough exact revision/source evidence to decide whether the surviving STAGING is safely resumable,
stale-retireable, or otherwise unclassified.

Canonical recovery therefore requires one distinct new-SHA **full read-only** classification before any
transport root-cause implementation or another write-capable attempt:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

Autocontinue may dispatch only the full read-only recovery workflow. Any `APPLIED`, `NOT_APPLIED`,
`RECOVERY_REQUIRED`, revision/source diagnostic or ambiguity from that run is evidence for the next
causal decision only; it does not itself authorize replay. Google remains authoritative and first
verified `COMMITTED` shadow is still unproven.

### Bootstrap HTTPS transport correction after full recovery `36770812477`

Exact-main PR #900 established the required full read-only classification on
`b7b221408d3e6e69c41e963f092e73b908e45b64`. Canonical CI `36770667208` and Browser Quality
`36770666954` passed. Recovery autocontinue `36770773729` dispatched exactly one full
`R1 initial bootstrap recovery`, run `36770812477`.

That recovery passed exact-main/source/provider/private-trigger-free gates and its single read-only
invoke. Privacy-safe output was:

```text
PASS / INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED
RECOVERY_REQUIRED / STAGING_RUN_PRESENT
R1_STAGING_REVISION_EVIDENCE=AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH
R1_STAGING_DURABLE_REVISION_EVIDENCE=COMPLETE_CURRENT_RUN_ONLY
R1_STAGING_RETIREMENT_EVIDENCE=STALE_STAGING_CURRENT_STATE_EMPTY
R1_STAGING_SOURCE_DECODE_EVIDENCE=NONE
R1_STAGING_EXACT_REVISION_EVIDENCE=EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN
```

No readiness, orchestrator, bootstrap, resume, retirement, cleanup, timer, cutover or authority switch
was dispatched from this recovery. The surviving run is therefore not resumable from exact current
source evidence; the only bounded write-capable recovery state is
`STAGING_STALE_RETIREABLE`, which still requires a distinct new-SHA root-cause PR and fresh
orchestrator recovery before any financial shadow write.

The write-capable bootstrap that produced the current boundary was child `36768370208`. All pre-invoke
gates passed and the dedicated Function version had `execution-timeout=600s`, while the HTTPS invoker
used global Node `fetch()` with an outer `AbortSignal.timeout(630000)`. The call nevertheless ended
after approximately 301 seconds with only:

```text
FAIL / INITIAL_BOOTSTRAP_INVOKE_FAILED
```

and no Function/application enum. Upstream Undici documents a default HTTP parser
`headersTimeout=300e3`; Node `fetch()` does not expose that option directly and requires a custom
dispatcher to change it. The observed ~301-second transport loss is therefore consistent with a
client-side headers timeout that is shorter than the intended 630-second overall invocation envelope.

The bounded successor changes only the bootstrap invocation transport:

- global `fetch()` is replaced by built-in `node:https.request`;
- one explicit 630-second overall request timer remains the only long-invoke client deadline;
- exact private HTTPS origin/function tag, bearer authentication, 64 KiB response cap and exact
  enum-only parser are preserved;
- no automatic retry is added;
- Function memory/execution timeout, YDB write set, migration cap, stale-retirement predicates,
  reconciliation and financial semantics are unchanged.

This is the second bounded root-cause attempt for the current
`FAIL/INITIAL_BOOTSTRAP_INVOKE_FAILED + STAGING_STALE_RETIREABLE` circuit. If the same signature
survives this attempt, the existing two-attempt circuit must stop with `BLOCKED_NEEDS_ROOT_CAUSE`
instead of dispatching another bootstrap.

The exact successor marker is:

```text
Provider-Attempt: READY
Observed-Signature: FAIL/INITIAL_BOOTSTRAP_INVOKE_FAILED
Expected-Transition: R1_BOOTSTRAP_ORCHESTRATOR_COMMITTED
Recovery-State: STAGING_STALE_RETIREABLE
Circuit-Rearm: ROOT_CAUSE_FIX
Regression-Test: tests/integration/yandex-initial-bootstrap-invoker.test.mjs
```

Only a new exact-main SHA may consume this marker. The orchestrator must first repeat fresh read-only
recovery and stale-retirement guards, then fresh readiness, and may dispatch at most one bootstrap
child. Any non-success/unknown result again requires its single post-invoke read-only recovery and
stops without replay. Google remains authoritative until a separately proven `COMMITTED` baseline
and required independent reconciliation/catch-up.

### Async invocation contract after exhausted synchronous circuit

Exact-main `14004f4119781a2cd02208cc0e6fe9aeb3ee802c` consumed the second bounded synchronous
root-cause attempt. CI `36772888005`, Browser Quality `36772888054` and readiness
`36773320121` passed. Orchestrator `36773091950` completed mandatory post-invoke recovery after
bootstrap `36773555381`.

The bootstrap passed every pre-invoke gate but returned:

```text
FAIL / INITIAL_BOOTSTRAP_INVOKE_FAILED
```

The native HTTPS caller survived a materially different interval than the prior Undici path, so the
previous 300-second client parser timeout was not the complete root cause. Post-invoke recovery again
proved only:

```text
RECOVERY_REQUIRED / STAGING_RUN_PRESENT
R1_STAGING_REVISION_EVIDENCE=AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH
R1_STAGING_DURABLE_REVISION_EVIDENCE=COMPLETE_CURRENT_RUN_ONLY
R1_STAGING_RETIREMENT_EVIDENCE=STALE_STAGING_CURRENT_STATE_EMPTY
R1_STAGING_EXACT_REVISION_EVIDENCE=EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN
```

The synchronous attempt circuit is therefore terminally `BLOCKED_NEEDS_ROOT_CAUSE`; no third sync
bootstrap or same-boundary transport replay is allowed.

Owner 2026-10-01 approved a separate bounded Yandex Cloud Functions asynchronous invocation contract.
Current Yandex Cloud documentation marks asynchronous invocation as Preview. The version-level contract
supports zero retries, a service account allowed to invoke the Function, and empty success/failure
targets. The HTTPS caller uses `integration=async` and receives HTTP 202 on accepted admission.

PrihRash adopts the following stricter R1 contract:

- tag: `r1-initial-bootstrap-async`;
- `async-max-retries=0`;
- existing exact Function invoker service account only; no IAM widening;
- no Yandex Message Queue destinations and no new paid resources;
- `HTTP 202` maps only to
  `PASS / INITIAL_BOOTSTRAP_ASYNC_ACCEPTED`;
- response body is discarded and cannot prove application result;
- async admission has a short bounded client timeout and no retry;
- provider-capable workflow is not part of the first contract slice;
- after future one-shot async admission, wait at least the full configured Function execution window
  before durable read-only recovery;
- only recovery may classify applied/failed/unknown state;
- first `COMMITTED` still requires independent reconciliation and required catch-up.

The first implementation slice contains only
`scripts/invoke-yandex-initial-bootstrap-async.mjs`, synthetic integration tests, and these canonical
process rules. It has no provider marker and must not dispatch Yandex readiness/orchestrator/bootstrap.

Provider-Attempt: NOT_AUTHORIZED
Async-Contract: REPOSITORY_ONLY
Expected-Transition: ASYNC_INVOCATION_CONTRACT_VERIFIED
Regression-Test: tests/integration/yandex-initial-bootstrap-async-invoker.test.mjs

### Async provider plumbing before any new attempt

Exact main `24a402ed559d39474a6656573c05192bedbd60d0` contains the repository-only async admission
contract from PR #902. Canonical CI `36778372911` and Browser Quality `36778372876` passed, and
no async provider attempt was dispatched.

The next implementation slice extends the **existing** bootstrap/orchestrator engine rather than
creating a second migration engine:

- `r1-initial-shadow-bootstrap.yml` gets explicit `sync|async` invocation mode;
- async deploy uses tag `r1-initial-bootstrap-async`, `async-max-retries=0` and the already-existing
  WIF service account as async invoker;
- the workflow fails closed unless that exact service account already has
  `functions.functionInvoker` on the exact Function;
- no IAM binding is created by the async path;
- no YMQ success/failure destination is configured;
- post-deploy `GetVersionByTag` must read back active Node.js 22 / bootstrap handler / 1 GiB /
  600-second runtime config plus async retries `0`, exact invoker service account and empty
  success/failure targets;
- async HTTPS admission accepts only `HTTP 202` and publishes only
  `PASS / INITIAL_BOOTSTRAP_ASYNC_ACCEPTED`;
- existing sync mode remains unchanged and continues to parse the application result directly.

The existing orchestrator receives a separate `async_invocation` input. For async mode, even a
successful child workflow **cannot** produce `R1_BOOTSTRAP_ORCHESTRATOR_COMMITTED`. After any
reached async admission it waits 610 seconds, covering the configured 600-second Function execution
window, then runs the existing read-only durable recovery. Its only async terminal evidence is
`R1_BOOTSTRAP_ORCHESTRATOR_ASYNC_POST_WINDOW_RECOVERY_CLASSIFIED` or an unresolved stop.

This plumbing PR intentionally contains **no** autocontinue provider marker and no new automatic
dispatch rule. Merge therefore verifies capability only. A later distinct exact-main PR must provide
the Owner-approved async provider marker, prove fresh stale-STAGING retirement/read-back and readiness,
and authorize exactly one orchestrator run with `async_invocation=true`.

```text
Provider-Attempt: NOT_AUTHORIZED
Async-Provider-Plumbing: READY_FOR_CI
Expected-Transition: ASYNC_PROVIDER_PLUMBING_VERIFIED
Regression-Test: tests/tooling/r1-initial-bootstrap-orchestrator-workflow.test.mjs
```

Google remains authoritative. Async `202` is admission only; only post-window durable recovery can
classify the YDB state, and first `COMMITTED` still requires independent reconciliation/catch-up.

### Fresh full recovery before first async admission

The second bounded synchronous transport attempt is still the last financial shadow write attempt:
orchestrator `36773091950` on
`14004f4119781a2cd02208cc0e6fe9aeb3ee802c` dispatched bootstrap child `36773555381`.
That child passed all pre-invoke gates but returned only
`FAIL / INITIAL_BOOTSTRAP_INVOKE_FAILED`. Its immediate post-invoke recovery returned
`RECOVERY_REQUIRED / STAGING_RUN_PRESENT`, but that recovery completed before the Function's full
600-second execution window could be treated as exhausted; it therefore cannot be used as current
write authority.

Owner-approved asynchronous invocation is now implemented only as a separate contract/plumbing
capability. PR #902 established the repository-only admission contract. PR #903 merged provider
plumbing into exact main `4a520247056e2b55d323110761c3eb014c8d1975`; canonical CI
`36781760182` and Browser Quality `36781760087` passed. Ordinary and recovery autocontinue for
that merge both stopped on invalid/non-provider markers, so no async readiness, orchestrator,
Function deploy or admission occurred.

Before the first async provider attempt, durable state must therefore be classified again on a
distinct new SHA. This successor is read-only only:

```text
Provider-Attempt: NOT_AUTHORIZED
Recovery-Probe: READY
Expected-Transition: READ_ONLY_EXACT_REVISION_CLASSIFICATION
Recovery-State: STAGING_PRESENT_UNCLASSIFIED
Regression-Test: tests/tooling/r1-initial-bootstrap-recovery-autocontinue-workflow.test.mjs
```

Recovery autocontinue may dispatch exactly one normal full
`r1-initial-bootstrap-recovery.yml` run with `surface_only=false`. It may read Google/YDB through
the existing recovery contract but cannot dispatch readiness/orchestrator/bootstrap, cannot retire or
resume STAGING, cannot create the async Function version, and cannot invoke the async tag.

Only the resulting fresh revision/digest/current-state evidence may decide whether the async
one-shot successor can use `STAGING_STALE_RETIREABLE`, another recovery state, or must stop. Owner
approval for the async delivery model does not convert unknown durable state into write authority.
Google remains authoritative and `COMMITTED` is still unproven.

### First async provider attempt after fresh full recovery `36782526425`

Exact main `0c2c4f06a5da00eec5bf4d8654f03930fc69c546` contains the Owner-approved async
contract/plumbing from PRs #902/#903 plus the read-only pre-attempt boundary from PR #904. Canonical
CI `36782383319` and Browser Quality `36782383316` passed.

Full recovery `36782526425` then completed `SUCCESS` on that exact main. Its single read-only
recovery invoke returned:

```text
PASS / INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED
RECOVERY_REQUIRED / STAGING_RUN_PRESENT
R1_STAGING_REVISION_EVIDENCE=AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH
R1_STAGING_DURABLE_REVISION_EVIDENCE=COMPLETE_CURRENT_RUN_ONLY
R1_STAGING_RETIREMENT_EVIDENCE=STALE_STAGING_CURRENT_STATE_EMPTY
R1_STAGING_SOURCE_DECODE_EVIDENCE=NONE
R1_STAGING_EXACT_REVISION_EVIDENCE=EXACT_CURRENT_RUN_SOURCE_NOT_PROVEN
```

This evidence still forbids resume. It does allow the existing guarded stale-STAGING retirement path,
but only inside a distinct new-SHA orchestrator run that repeats fresh recovery/read-back and readiness
before any bootstrap child.

The first async provider attempt is a separate Owner-approved delivery-model attempt and does not
reopen or reset the exhausted synchronous `ROOT_CAUSE_FIX` circuit. Its autocontinue marker is:

```text
Async-Provider-Attempt: READY
Owner-Decision: R1_ASYNC_INVOCATION_CONTRACT_APPROVED
Observed-Recovery: INITIAL_BOOTSTRAP_RECOVERY_CLASSIFIED/RECOVERY_REQUIRED/STAGING_RUN_PRESENT
Expected-Transition: R1_BOOTSTRAP_ORCHESTRATOR_ASYNC_POST_WINDOW_RECOVERY_CLASSIFIED
Recovery-State: STAGING_STALE_RETIREABLE
Recovery-Run-ID: 36782526425
Regression-Test: tests/tooling/r1-initial-bootstrap-autocontinue-workflow.test.mjs
```

The marker is valid only for a process-only changeset containing the autocontinue workflow, its focused
regression test and this runbook. Autocontinue must independently verify recovery run
`36782526425`, its successful read-only invoke, its enum-only artifact, and ancestry to the new exact
main SHA. It then dispatches the existing orchestrator only with:

```text
allow_staging_resume=false
allow_stale_staging_retirement=true
async_invocation=true
```

The orchestrator must re-prove fresh stale retirement/read-back and readiness. The bootstrap child may
create exactly one async-configured Function version with retries `0`, existing invoker service
account and empty success/failure targets, then perform one `HTTP 202` admission. Admission is never
`COMMITTED`. After any reached async admission the orchestrator waits 610 seconds and only then
classifies durable state through the existing read-only recovery path.

Any marker ambiguity, ancestry mismatch, recovery/artifact mismatch, changed main, async config mismatch,
non-202 admission, or post-window recovery ambiguity stops without replay. No third synchronous
bootstrap is authorized. Google remains authoritative until a separately proven first `COMMITTED`
baseline and independent reconciliation/catch-up.

### Read-only recovery after failed first async version deployment `36783942040`

The first Owner-approved async orchestrator reached its guarded write-capable child only after fresh
stale-STAGING retirement/read-back and readiness. Child `36783942040` passed exact-source, readiness,
OIDC, provider-boundary and exact-main checks, but failed at
`Deploy initial-bootstrap-only Function version` before async config read-back or any Function
invocation. The async admission step was skipped, so no `HTTP 202` was accepted and no async financial
shadow execution was started by that child.

The create command returned nonzero with stderr kept private on the runner. Therefore its provider write
outcome is not inferred from the exit code. Before any corrected deployment, PrihRash performs one
new-SHA **read-only async deploy recovery** covering the exact failed deploy step window.

External Yandex documentation confirms that the CLI flags used by the failed attempt are current:
`--async-max-retries` and `--async-service-account-id`. It also confirms that assigning a service
account to a resource requires the caller to be allowed to use that service account
(`iam.serviceAccounts.user`). Existing PrihRash IAM design already grants deployment WIF the right to
use the exact runtime SA `prihrash-initial-bootstrap`, while that runtime SA is retained as an exact
Function `functions.functionInvoker`. No IAM widening is authorized.

The diagnostic marker is:

```text
Provider-Attempt: NOT_AUTHORIZED
Async-Deploy-Recovery: READY
Failed-Async-Deploy-Run-ID: 36783942040
Failed-Async-Deploy-SHA: c8c45e88e1e3c58f7b168c56ae4f1edc1d850c16
Expected-Transition: READ_ONLY_ASYNC_DEPLOY_CLASSIFICATION
Regression-Test: tests/tooling/r1-async-deploy-recovery-classifier.test.mjs
```

After exact-main CI, temporary workflow
`.github/workflows/r1-initial-bootstrap-async-deploy-recovery.yml` may perform only:

- read the exact failed GitHub job timestamps;
- read the dedicated Function/version list;
- read exact Function access bindings;
- read access bindings **on** the runtime service account;
- classify whether an async-tag or failed-window version already exists;
- classify whether runtime SA has exact Function `functions.functionInvoker`;
- classify whether deployment WIF has `iam.serviceAccounts.user` on runtime SA;
- publish one enum-only artifact.

It must not create/update/delete Function versions, invoke Functions, mutate IAM, touch Google/YDB data,
retire STAGING, run readiness/bootstrap, or infer application success.

Only
`SAFE_TO_CORRECT_CONFIG / NOT_APPLIED / runtimeInvoker=PRESENT /
wifRuntimeServiceAccountUser=PRESENT` may support a later distinct fix that changes async executor from
deployment WIF to the already-authorized runtime SA. Any existing/ambiguous version or missing IAM
boundary remains STOP and does not authorize replay.

### Readable-surface correction after diagnostic `36785159882`

Exact-main diagnostic `36785159882` on `30ac0e749f46841ef67335df51760e795dbe4d8b`
proved its GitHub authority, OIDC exchange and initial provider reads, then stopped at:

```text
R1_ASYNC_DEPLOY_RECOVERY_RUNTIME_BINDINGS_READ_FAILED
```

No Function create/invoke, IAM mutation or financial data access occurred. The stop means the deployment
WIF is not authorized to enumerate access bindings **on** the runtime service-account resource; it does
not prove that `iam.serviceAccounts.user` is absent and must not be used to justify IAM widening.

The first read-only recovery classifier reuses only currently readable Function/version evidence and
does not infer that a missing list candidate means `NOT_APPLIED`:

- exact failed deploy timestamps from child `36783942040`;
- bounded Function version list and exact-window `CreateFunctionVersion` operation history;
- typed operation response/metadata version ID, when present;
- exact `GetVersionByTag` configuration and `ListTagHistory` interval;
- current exact Function access bindings to verify runtime SA still has
  `functions.functionInvoker`.

Only exact version ID + actor/time-bound operation + complete async/runtime/entrypoint/Lockbox config +
active tag interval can produce `INVOCATION_ONLY_READY`. Missing operation provenance or incomplete
version/tag evidence remains `DEPLOYMENT_OUTCOME_UNCLASSIFIED` / `PREVIOUS_VERSION_UNPROVEN`; it never
becomes `NOT_APPLIED` by absence. Exact terminal `INVALID_ARGUMENT`/`FAILED_PRECONDITION` operation
evidence selects a repository request-contract fix. Exact `PERMISSION_DENIED` stops without IAM
widening. The one-shot invocation allowance was not consumed because async invoke was skipped; only an
invocation-only successor marker may reuse an exact proven immutable version, and it must repeat fresh
recovery/readiness gates. No create or invoke is authorized by the read-only classifier.

The same read-only marker is reused on a **new SHA**:

```text
Provider-Attempt: NOT_AUTHORIZED
Async-Deploy-Recovery: READY
Failed-Async-Deploy-Run-ID: 36783942040
Failed-Async-Deploy-SHA: c8c45e88e1e3c58f7b168c56ae4f1edc1d850c16
Expected-Transition: READ_ONLY_ASYNC_DEPLOY_CLASSIFICATION
Regression-Test: tests/tooling/r1-async-deploy-recovery-classifier.test.mjs
```

The bounded result has distinct engineering outcomes:

- `INVOCATION_ONLY_READY / VERSION_PROVEN` → no second Function version create; a separate exact-main
  marker may arm one async admission against the proven version after fresh recovery/readiness;
- `REQUEST_CONTRACT_INVALID / CREATE_OPERATION_FAILED` → fix the exact async request/configuration and
  preserve the Owner async boundary;
- `CREATE_PERMISSION_DENIED` or `IAM_BOUNDARY_MISSING` → STOP without IAM widening;
- `PREVIOUS_VERSION_UNPROVEN`, `PREVIOUS_WRITE_AMBIGUOUS`, `CREATE_OPERATION_IN_PROGRESS`, or
  `DEPLOYMENT_OUTCOME_UNCLASSIFIED` → STOP; do not infer `NOT_APPLIED`, repeat the same query, create a
  version, or invoke.

Only current exact Function `functions.functionInvoker` evidence is read; runtime-SA resource bindings
are not queried because this WIF surface is not authorized to enumerate them. A later corrected async
create still fails closed before invoke if `iam.serviceAccounts.user` was revoked. No new IAM grant is
authorized. These terminal cases, the shared caller predicates and the Owner anti-S-unit rule are
covered in one Incident-M with synchronized `AGENTS.md` and `docs/R1_COMPLETION_SPRINT.md`.

