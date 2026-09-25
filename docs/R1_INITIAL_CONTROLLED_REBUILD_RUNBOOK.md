# R1 Initial Controlled Rebuild Runbook

## Status and authority

This runbook is the production WU7 continuation boundary for the first R1 shadow baseline. It does not change financial authority: until a separate CUTOVER gate, **Google remains authoritative and YDB remains shadow**. Scheduled sync/timer and production Writer stay disabled.

The live trigger for this path is a previously proven exact initial-bootstrap result `INITIAL_BOOTSTRAP_CONTROLLED_REBUILD_REQUIRED` plus read-only recovery of the same durable resumable run. It is not a generic repair command and it must not create a new bootstrap identity.

Provider execution requires an open dynamically supplied R1 WU7 tracking Issue whose body contains the machine-readable authority block:

```text
Provider-Authority: WU7_CONTROLLED_REBUILD
Authority-Scope: PRODUCTION_YDB_INITIAL_SHADOW_ONLY
Google-Authority: PRESERVED
Cap-Increase: FORBIDDEN
Timer-Cutover: FORBIDDEN
Blind-Replay: FORBIDDEN
```

## Live prerequisite

Before the one write-capable WU7 dispatch, all of the following must be proven on the exact current `main` SHA:

1. canonical CI PASS and protected `main`;
2. fresh `R1 Yandex readiness` PASS with `READINESS_READY`;
3. read-only initial-bootstrap recovery still proves exactly one current resumable run and no verified `COMMITTED` baseline;
4. the WU7 tracking Issue is open and carries the exact authority block above;
5. no competing R1 writer PR/run owns the same production write surface.

If any prerequisite changes or becomes ambiguous, stop before deployment/invocation.

## Function-version deployment recovery

A failed `yc serverless function version create` is itself an unknown provider-write outcome. A nonzero CLI exit does not prove that the Function version was not created. After such a failure, the controlled rebuild invocation must stay stopped; do not rerun version creation and do not invoke the tag blindly.

The only allowed next action is the manual read-only `R1 initial controlled rebuild deploy recovery` workflow on exact current `main`. It must bind both the exact current recovery-code SHA and the separate immutable SHA of the failed controlled-rebuild run, prove that the run failed before invocation, re-check the open WU7 authority boundary and verify that no competing R1 writer is active. The accepted pre-invoke failure modes are: (1) legacy Function-version deploy step failure with the controlled invoke step skipped; (2) private/trigger-free live metadata postflight failure with the controlled invoke step skipped, with the deploy step either intentionally skipped in reuse mode or already successful in a deploy/repair mode; or (3) the privacy-safe `INITIAL_CONTROLLED_REBUILD_PROVIDER_DEPLOY_FAILED / failureClass` artifact proves a create failure from the `continue-on-error` deploy step, the bounded-result gate failed, evidence publication succeeded, and controlled invoke remained skipped. Mode (3) is required because GitHub records the handled deploy step as `success` even though the provider command failed; the enum artifact plus final failed gate is the canonical proof, not that step conclusion alone. The failed-run SHA is intentionally separate because recovery tooling may be merged after the failed provider attempt.

Recovery reads Function/version metadata only. The exact tag `r1-initial-controlled-rebuild` is the discriminator:

- no matching tag → `NOT_APPLIED / TAG_ABSENT`;
- exactly one matching `ACTIVE` version with runtime `nodejs22`, entrypoint `index.initialControlledRebuildHandler` and exact runtime service account `prihrash-initial-bootstrap` → `APPLIED / EXACT_ACTIVE_TAG`;
- Function/version read failure, non-active or mismatched metadata, wrong runtime service account, or ambiguous matching evidence → `RECOVERY_REQUIRED`.

`APPLIED` proves only the Function-version deployment layer. It does not prove that the controlled rebuild handler ran, that YDB staging/swap/marker mutations occurred, or that a verified baseline exists. `NOT_APPLIED` permits a later separately gated deploy only after its cause is understood and the exact-main/recovery/readiness gates are refreshed as required. `RECOVERY_REQUIRED` forbids invocation and blind replay.

The WU7 target no longer requires Yandex Cloud Functions Preview async-invocation configuration. Historical `TAG_ASYNC_CONFIG_MISSING` evidence showed that the existing active tag lacked that optional provider layer; it is not a reason to recreate an otherwise exact synchronous Function version. On the current contract, deploy recovery re-evaluates the same tag using only runtime, entrypoint, active status and exact runtime service account. This avoids replaying the create request that repeatedly failed at the Preview async-configuration boundary, without widening IAM or changing financial semantics.

The deploy-recovery workflow has no Function-version create/invoke command and no Google/YDB mutation authority. It remains backward-compatible with historical pre-invoke failures that used the old asynchronous step name and historical three/four-field provider-deploy failure artifacts. Its provider diagnostic may continue to observe existing runtime-account invoker/viewer bindings as legacy live state, but those bindings are not prerequisites for the synchronous WU7 transport and must not justify IAM widening. The exact Function `functions.editor` and `functions.functionInvoker` bindings for the GitHub WIF caller remain the deployment/invocation prerequisites. Raw provider messages, operation IDs, service-account IDs and Function IDs are never published.

When deploy recovery proves `APPLIED / EXACT_ACTIVE_TAG` and the failed controlled run proves its invoke step was skipped, the already-created version may be reused only through the existing controlled workflow recovery mode. That mode requires a successful deploy-recovery run on the exact current `main`, fresh exact-main recovery `VALIDATED_CURRENT_EMPTY_STAGING_ABSENT`, fresh `READINESS_READY`, and the open WU7 authority gate. It skips Function-version creation, re-reads live version metadata and requires exactly one active `r1-initial-controlled-rebuild` tag with runtime `nodejs22`, entrypoint `index.initialControlledRebuildHandler` and the expected runtime service account. Only then may it issue one synchronous invocation.

## Unknown invocation recovery

If the controlled Function invocation itself ends with a transport failure/timeout after the handler may have started, its YDB write outcome is unknown. Do not replay the handler. First run the existing read-only initial-bootstrap recovery on the exact current `main`.

When durable recovery reports `VALIDATED_RUN_PRESENT`, the recovery-only handler refines that state using YDB scheme/current/staging reads only and emits one of these enum reasons without counts, amounts or row content:

- `VALIDATED_CURRENT_EMPTY_STAGING_ABSENT` — validation transition is durable; run-scoped staging tables are absent.
- `VALIDATED_CURRENT_EMPTY_STAGING_EMPTY` — the staging table pair exists but remains empty. This is resumable only through a separately gated controlled continuation: the runtime must reuse the exact pair, skip `copyTables`, prove the staging snapshot is still empty, and only then start bounded materialization.
- `VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY` — staging contains data; completeness is not assumed.
- `VALIDATED_CURRENT_NONEMPTY_STAGING_ABSENT` — canonical current is non-empty and staging is absent; swap may have applied, but exact post-swap reconciliation is still required.
- `VALIDATED_CURRENT_NONEMPTY_STAGING_PRESENT` — current and staging are both present; stop for explicit recovery.
- `VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS` or `VALIDATED_CONTROLLED_DIAGNOSTIC_FAILED` — stop; no replay.

These enums are structural evidence only. They do not declare staging completeness, swap success or a verified baseline. Any later continuation remains separately gated and must use the existing exact staging/swap/marker discrimination before its next mutation.

## Synchronous continuation transport

WU7 uses the already-implemented synchronous Function invocation path (`integration=raw`) instead of Yandex Cloud Functions Preview async-invocation configuration. The Function execution timeout is 600 seconds, the invoker timeout is 630 seconds, and the GitHub job timeout is 30 minutes. This keeps the provider surface to normal Function version deployment plus one authenticated invocation and avoids an extra Preview configuration/IAM layer that repeatedly returned create-time `PERMISSION_DENIED`.

Before invocation, the exact Function `prihrash-r1-initial-bootstrap` must contain:

- GitHub WIF caller `prihrash-github-initial-bootstrap` → `functions.editor` on the exact Function, for Function-version creation;
- GitHub WIF caller `prihrash-github-initial-bootstrap` → `functions.functionInvoker` on the exact Function, for the single synchronous invocation.

The runtime service account `prihrash-initial-bootstrap` remains attached to the Function version and retains its YDB/Lockbox runtime permissions. Deployment WIF still requires `iam.serviceAccounts.user` on that exact runtime service account to attach it to a Function version. Existing exact-Function runtime-account `functions.functionInvoker` / `functions.viewer` bindings are retained as live provider state for now but are no longer WU7 prerequisites; do not remove them automatically. Least-privilege retirement is a separate evidence-backed action after R1 success.

Do **not** grant invocation roles on the folder/cloud and do not broaden the deployment WIF to primitive `editor`/`admin` or broader IAM roles as a diagnostic shortcut. Repository workflows do not create or modify IAM bindings.

A synchronous response is accepted as success only when the exact bounded result is `INITIAL_CONTROLLED_REBUILD_COMMITTED`. A timeout, transport error, HTTP error, STOP, NOOP or runtime failure is non-success and immediately enters the existing read-only recovery boundary. The handler is never blindly replayed after an unknown synchronous outcome.

For a non-200 synchronous response, the invoker does not read or publish the response body, provider error message or stack. It records only the bounded HTTP enum plus whether the provider response contains the `X-Function-Error` header as `functionError=PRESENT|ABSENT`. This distinguishes a provider-marked function-code failure from an HTTP failure without that signal while keeping private/error payloads out of Actions artifacts. The header classification is diagnostic evidence only and never authorizes replay by itself.

### Live WU7 one-shot on `24f16aee433aecdf014165f58bea7ef498bb1b29`

Owner-authorized controlled run `35542663922` consumed its one-shot authority after fresh recovery `35542444650` proved the exact resumable `STAGING_RUN_PRESENT` surface and readiness `35542581731` returned `READINESS_READY`. The workflow passed authority, exact-main, prerequisite and private/trigger-free provider gates, deployed the reviewed controlled handler, rechecked exact main immediately before invocation and issued exactly one synchronous invoke. The bounded workflow result was `INITIAL_CONTROLLED_REBUILD_INVOKE_OUTPUT_INVALID`; temporary phase evidence was unavailable as `INITIAL_CONTROLLED_REBUILD_PHASE_UNAVAILABLE / LOG_READ_FAILED`. The authority Issue #703 was then closed as consumed and no replay occurred.

Mandatory read-only recovery `35542815879` subsequently proved the durable state had not advanced: `RECOVERY_REQUIRED / STAGING_RUN_PRESENT`, both revision evidence diagnostics remained `COMPLETE_CURRENT_RUN_ONLY`, verified current remained empty, source decoding had no blocker, and exact revision evidence remained `EXACT_CURRENT_RUN_MATCH`. Therefore neither swap nor `COMMITTED` is proven, and the failed invoke cannot be replayed under the consumed authority.

Repository inspection found one diagnostics-contract mismatch at a reachable pre-write continuation phase: while a durable `STAGING` controlled continuation performs `RECONCILIATION_READ` inside controlled `PREPARATION`, the Function sanitizer can safely emit `APPLICATION_FAILED / PREPARATION / RECONCILIATION_READ`, but the controlled invoker and workflow result guard did not allow that exact `bootstrapPhase`. They consequently collapsed such a bounded runtime failure into `INITIAL_CONTROLLED_REBUILD_INVOKE_OUTPUT_INVALID`. The repository correction only aligns this enum allowlist and regression coverage. It does not change financial semantics, resource caps, provider IAM, writer authority or durable state, and does not arm another controlled rebuild attempt.

## Controlled path

The runtime reuses existing WU7 primitives and the durable bootstrap identity/revision evidence:

`exact STAGING/VALIDATED continuation → bounded staging setup → bounded staging batches → staging reconciliation → read-only swap discrimination → at most one atomic two-table swap → exact current verification → COMMITTED marker → exact post-commit verification`.

The ordinary calibrated promotion cap is unchanged. Controlled staging batches are individually rechecked by the same calibrated atomic preflight. No transaction is enlarged merely to force the bootstrap through.

The deterministic transaction timestamp for the reconstructed controlled candidate is the durable `MigrationRun.startedAt`. A continuation therefore rebuilds the same current-write candidate instead of inventing a new timestamp on each recovery attempt.

After two separately gated synchronous invocations returned `HTTP_502 / functionError=PRESENT` and mandatory recovery twice proved `VALIDATED_CURRENT_EMPTY_STAGING_ABSENT`, the runtime source lifetime is bounded before controlled preparation. The Google reader, digest, access-token provider and full snapshot lease exist only inside observation construction and become unreachable before the application continuation starts. This mirrors the already-proven initial-bootstrap memory-lifetime correction and reduces peak retained source state without changing the observation, financial semantics, write set, calibrated caps, retries, IAM or provider authority.

The first exact-source invocation after that correction no longer failed with provider-marked `HTTP_502`; instead the synchronous HTTPS client disconnected at approximately 301 seconds with `INITIAL_CONTROLLED_REBUILD_INVOKE_FAILED`, and mandatory recovery again proved `VALIDATED_CURRENT_EMPTY_STAGING_ABSENT`. Yandex Cloud documents a 300-second HTTP keep-alive boundary and proportional CPU allocation below 2 GB RAM. The controlled Function resource envelope is therefore raised from 256 MB to 1 GB for this stage-specific WU7 invocation so preparation can complete inside the supported synchronous HTTP window. This changes neither quotas nor authority, and does not change the 600-second Function execution timeout, financial semantics, write set, calibrated batching caps, retries, IAM, timer/cutover or Google authority.

The first separately gated 1 GB invocation passed deploy/postflight and ran past the prior ~301-second failure boundary, but still ended with `INITIAL_CONTROLLED_REBUILD_INVOKE_FAILED`. Mandatory read-only recovery then proved `VALIDATED_CURRENT_EMPTY_STAGING_EMPTY`: the durable validation transition and exact run-scoped staging setup exist, while both staging tables remain empty and canonical current is still empty. This state does not authorize replay of setup. A later continuation may proceed only through the exact recovery/readiness/WU7 gates; the application reuses the existing empty staging pair, does not call `copyTables` again, re-proves emptiness, and then resumes bounded materialization.

A subsequent separately gated 1 GB continuation again lost the synchronous transport at approximately 301 seconds, and both immediate and post-600-second read-only recovery proved the same `VALIDATED_CURRENT_EMPTY_STAGING_EMPTY` state. This rules out a late durable staging write from that invocation and makes another blind retry unjustified. The next bounded diagnostic enables temporary controlled-Function logging and emits only allowlisted `R1_CONTROLLED_PHASE:<ENUM>` markers. After a failed invoke, the workflow attempts to read the exact tagged Function logs from the invocation start time, discards raw logs locally, and may publish only `INITIAL_CONTROLLED_REBUILD_PHASE_CLASSIFIED / lastPhase` or a bounded `INITIAL_CONTROLLED_REBUILD_PHASE_UNAVAILABLE` reason. No financial row, amount, description, payload, reconciliation total, provider identifier or raw log is published. Existing IAM is not widened; `LOG_READ_FAILED` is a valid diagnostic outcome. Controlled-Function logging is stage-specific temporary instrumentation and must be disabled again after the R1 blocker is localized/resolved.

The diagnostic invocation itself again lost synchronous transport at approximately the same boundary. Its bounded phase classifier returned `INITIAL_CONTROLLED_REBUILD_PHASE_UNAVAILABLE / LOG_READ_FAILED`, and mandatory read-only recovery again proved `VALIDATED_CURRENT_EMPTY_STAGING_EMPTY`; no IAM widening is authorized just to read Cloud Logging. Code inspection identifies a repeated O(N) pre-materialization operation that is unnecessary once the same run is already durable `VALIDATED`: full revision-payload reconciliation is the proof used to enter `VALIDATED`, while exact resume already re-proves the same source snapshot digest, durable identity manifest and run counters. Therefore a `VALIDATED` controlled continuation reuses that durable validation proof, rechecks projection/run invariants, deterministically rebuilds the candidate, and proceeds to existing staging evidence/materialization. A `STAGING` continuation still performs full durable reconciliation before any validation transition. This optimization changes neither the validated candidate contract nor write authority.

The first separately gated continuation after that optimization still returned `INITIAL_CONTROLLED_REBUILD_INVOKE_FAILED` at the same synchronous transport boundary. Both immediate recovery and recovery after the full Function lifetime again proved `VALIDATED_CURRENT_EMPTY_STAGING_EMPTY`, so no late staging write occurred. The repeated safe signature now trips the canonical Incident-M circuit breaker: no further provider invoke is armed by diagnosis alone. The next root-cause unit addresses a reproducible superlinear pre-materialization planner: `chunkStagingWrites` re-ran `assessAtomicPromotionWrites` over the entire growing batch for every appended write. A privacy-safe synthetic fixture of 5,000 writes at 128 estimated parameter bytes required about 9.4 seconds locally before any staging write. The Incident-M fix validates every write once and accumulates the same 512 KiB calibrated envelope linearly. Query-size validation, single-write rejection, batch boundaries, write order, batching cap and downstream preflight remain unchanged. The expected transition for any later separately authorized provider attempt is progress beyond pre-materialization into durable staging or an earlier bounded application result; persistence of the same invoke-failure signature is a stop condition, not permission for another replay.

The first separately re-armed continuation after the linear planner fix still lost the synchronous invoke transport at the same approximately 301-second boundary. Immediate recovery and recovery after the full Function lifetime again proved `VALIDATED_CURRENT_EMPTY_STAGING_EMPTY`, so the invocation did not durably complete even the first staging batch. This narrows the blocker from pre-materialization planning to staging execution itself. The staging executor previously preserved atomicity by issuing one `transaction.execute(...)` per prepared row inside a batch; a privacy-safe synthetic batch of 1,000 rows therefore produced 1,000 sequential provider calls before one transaction could commit. The next Incident-M root-cause fix keeps the same calibrated 512 KiB batch and transaction boundary but rewrites exact generated staging UPSERTs into the repository's existing `AS_TABLE($rows)` bulk pattern, with at most one provider execute per staging table in a batch. Exact statement shape, column/type consistency, query-size cap and primary-key non-nullability are checked fail-closed before opening the transaction. The controlled YDB client additionally uses bounded ready/read/transaction deadlines below the synchronous HTTP boundary. Financial semantics, write set, batch cap, swap/marker recovery, IAM and Google authority remain unchanged. A later provider attempt is not armed until this root-cause unit passes canonical verification and exact-main recovery/readiness gates.

The first continuation after that bulk-staging fix materially changed the live failure layer. Controlled run `35469651936` no longer died at the 301-second HTTP boundary: it completed staging reconciliation and reached swap recovery, returning `INITIAL_CONTROLLED_REBUILD_RECOVERY_REQUIRED / SWAP_OUTCOME_AMBIGUOUS`. Mandatory read-only recovery `35470315897` then classified the durable structure as `VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY`. This structural enum does **not** prove staging completeness and therefore does not authorize another controlled invoke. The next bounded action is read-only exact swap recovery discrimination. It reconstructs the same verified plan from the exact authoritative snapshot and durable identity evidence, rechecks the nonempty run-scoped staging reconciliation, and calls the existing `recoverUnknownControlledInitialSwapOutcome`. Its only bounded verdicts are `APPLIED`, `NOT_APPLIED`, or `RECOVERY_REQUIRED`; the diagnostic performs no staging write, rename/swap, marker transition, cleanup, timer/cutover action, or authority change. Only an exact `APPLIED` or `NOT_APPLIED` verdict may inform a later separately gated recovery continuation; `RECOVERY_REQUIRED` remains a stop boundary.

The manual swap-recovery execution surface must bind four pieces of exact evidence before its diagnostic-only Function deployment: the current protected main SHA with successful canonical CI, the historical controlled run whose enum-only artifact proves `SWAP_OUTCOME_AMBIGUOUS` and whose SHA is an ancestor of current main, a fresh exact-main recovery artifact proving `VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY`, and a fresh exact-main readiness artifact proving `READINESS_READY`. The diagnostic handler reconstructs the exact authoritative candidate, so its private Function version receives the same existing Google snapshot credentials and private historical evidence secret used by the controlled runtime, plus the YDB connection secret. This does not grant Google mutation authority: the diagnostic code path only reads Google/YDB evidence and calls read-only swap discrimination. Missing or mismatched evidence, configuration or artifact shape fails closed before diagnostic invocation.

The first execution-surface attempt after those gates stopped safely before any provider deployment because the workflow called the `:from-build` packaging target without first producing `dist/`; the exact-source restore intentionally does not provide compiled output. The packaging boundary therefore requires an explicit `npm run build` immediately before `package:initial-controlled-rebuild:from-build`. Early pre-provider failures must not be obscured by the evidence-upload step, so the diagnostic evidence upload tolerates a missing `classification.json` when invocation was never reached.

The first exact-main swap diagnostic after the packaging correction completed read-only with `RECOVERY_REQUIRED`. That tri-state remains a hard stop, but by itself it is too coarse to choose the next bounded recovery action. For `RECOVERY_REQUIRED` only, the diagnostic therefore publishes exactly one privacy-safe reason enum: `DURABLE_RUN_NOT_VALIDATED`, `SETUP_EVIDENCE_MISMATCH`, `STAGING_RECONCILIATION_MISMATCH`, or `SWAP_DISCRIMINATION_AMBIGUOUS`. These values identify only the read-only gate that prevented exact discrimination; they expose no financial payload, reconciliation totals, provider identifiers or secrets. `APPLIED` and `NOT_APPLIED` keep their existing exact result shape. A reason enum is diagnostic evidence only and never authorizes swap replay, cleanup or any other mutation.

The first post-reason exact-main diagnostic (`35497543991`) passed every authority/build/deploy gate and reached the read-only invoke, but the workflow stopped as `SWAP_RECOVERY_RESULT_INVALID`. The Function sanitizer can legitimately return a bounded runtime-failure object (`INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED` with allowlisted `jobCode` and controlled phase) when source/YDB/reference/application execution fails before a tri-state classification. The workflow must preserve that already-sanitized taxonomy as enum-only evidence instead of collapsing it into an indistinguishable invalid-result bucket. Only runtime failure codes and phases reachable by the diagnostic path are accepted; malformed or non-allowlisted shapes remain fail-closed. Capturing such evidence does not authorize replay, swap, cleanup or any other mutation.

After that contract was corrected, exact-main diagnostic `35500282782` classified the live blocker as `APPLICATION_FAILED / PREPARATION`. Because controlled `PREPARATION` wraps several already-existing bootstrap read/reconstruction phases, runtime failure evidence may additionally expose one allowlisted `bootstrapPhase` enum while the controlled phase is exactly `PREPARATION`: `ADMISSION_READ`, `RESUME_CONTEXT_READ`, `RESUME_IDENTITY_MANIFEST_READ`, `RESUME_SNAPSHOT_READ`, `RESUME_CONTEXT_PREPARATION`, `LINEAGE_PREPARATION`, `VALIDATION_EVALUATION`, `CURRENT_PLAN_PREPARATION`, or `CURRENT_WRITE_PREPARATION`. The field is cleared when controlled execution leaves `PREPARATION`; all other runtime failures publish `bootstrapPhase: null`. This is diagnostic-only metadata and carries no financial payload, totals, provider identifiers, secrets or mutation authority.

Последний read-only diagnostic `35505256401` на `9ce30163b5f43dc55323d76745a74f3b14120a55` локализовал blocker до `APPLICATION_FAILED / PREPARATION / RESUME_CONTEXT_READ`. Fresh recovery `35504901039` подтвердил `VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY`; readiness `35505177912` — `READINESS_READY`. Чтобы различить причины внутри resume-read, после успешной проверки snapshot digest выставляется `RESUME_IDENTITY_MANIFEST_READ`, а перед чтением durable snapshot — `RESUME_SNAPSHOT_READ`. Digest mismatch по-прежнему останавливается на `RESUME_CONTEXT_READ`: stale-STAGING retirement contract не изменён. Новые фазы не расширяют result schema или write authority. После merge допустим только один отдельно gated read-only diagnostic с fresh exact-main recovery/readiness; financial writes, replay, swap и cleanup этим изменением не разрешены.

## Read-only source drift при VALIDATED

Diagnostic `35506553480` на exact `5299dd379e57f4a488f6297a84102d6c0b56e4ff` повторно остановился на `APPLICATION_FAILED / PREPARATION / RESUME_CONTEXT_READ`. По текущему коду между этой фазой и следующим marker выполняется только snapshot digest check: это локализует отказ до mismatch authoritative observation и durable run. Manifest/snapshot reads не достигнуты. Recovery `35506459580` доказал `VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY`, readiness `35506461132` — `READINESS_READY`.

Full recovery для `VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY` теперь дополнительно выполняет один Google snapshot read и сравнивает его с согласованным durable run/manifest/snapshot. Используются существующие правила digest/binding/prefix/insertion-only comparison; STAGING classifier и retirement остаются ограничены STAGING. Остальные structural states и surface-only recovery не читают Google для этого diagnostic.

Поле `validatedSourceEvidence` содержит только один enum: `AUTHORITATIVE_SNAPSHOT_MATCH`, `AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH`, `AUTHORITATIVE_SNAPSHOT_PREFIX_PRESERVED`, `AUTHORITATIVE_SNAPSHOT_INSERTIONS_ONLY`, `AUTHORITATIVE_ROW_COUNT_MISMATCH`, `AUTHORITATIVE_BINDING_MISMATCH`, `VALIDATED_METADATA_INVALID` или `VALIDATED_SOURCE_DIAGNOSTIC_FAILED`. Reader error не превращается в source match. Invoker сохраняет прежний четырёхполевой classification и публикует enum отдельно; workflow сохраняет `validated-source.json` рядом с `classification.json`. Raw rows, digests, counts, identifiers и payload не публикуются.

Этот diagnostic не доказывает staging completeness, exact revision equality, swap outcome или COMMITTED baseline. Любой его enum оставляет `RECOVERY_REQUIRED` и не разрешает retirement VALIDATED run, rebuild/replay/swap/cleanup. После canonical gates допустима одна full read-only recovery на новом exact main. Следующий mutation path требует отдельного canonical gate; stale-STAGING terminalization contract нельзя применять к VALIDATED.

## Live-source rule: cutoff, а не quiet window

Нормативный [Migration Contract](MIGRATION_CONTRACT.md#71-live-authoritative-source-и-bootstrap-cutoff) запрещает предполагать остановку Google во время initial bootstrap. Каждый новый bootstrap связывается с immutable `Snapshot A`; staging/reconciliation/swap/COMMITTED этого run доказываются относительно A. Fresh Google `B != A`, появившийся **после** cutoff, является нормальным `AUTHORITATIVE_SOURCE_ADVANCED` и должен переходить в post-COMMITTED incremental catch-up `A → B`, а не автоматически превращать доказанный A в stale run.

`AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH` из legacy/current recovery diagnostic нельзя использовать как универсальное правило «retire and restart». Cutoff-aware continuation различает:
- invalid/unprovable bound observation A → fail-closed `BOOTSTRAP_OBSERVATION_INVALID`;
- proven A + newer current source B → resume восстанавливает immutable A только из exact durable `source_snapshots` + identity manifest + полного revision=1 raw-payload evidence того же run, продолжает baseline A и не подменяет его live B; после `COMMITTED(A)` catch-up обязателен отдельно через обычный `START_INCREMENTAL`.

Если хотя бы часть exact durable A отсутствует, malformed или не совпадает с manifest/snapshot/run binding, live B **не используется** для заполнения пробела: continuation fail-closed. Таким образом Google остаётся authoritative live source, а YDB evidence используется только как immutable resume evidence уже захваченного cutoff A, а не как вторая financial authority.

Текущий pre-contract WU7 run остаётся исключением: у него уже есть historical `SWAP_OUTCOME_AMBIGUOUS`, поэтому до Gate A нельзя promotion/replay/retirement переинтерпретировать новым правилом. Gate A закрывает именно старую unknown-write ambiguity; после этого новый initial bootstrap должен быть cutoff-aware и не зависеть от quiet window.
## Owner decision: stale VALIDATED recovery contract

Owner 2026-09-20 явно разрешил отдельный recovery contract для stale `VALIDATED` с сохранением audit/staging evidence. Нормативные predicates, marker-only transition и отдельный новый bootstrap определены в [MIGRATION_CONTRACT](MIGRATION_CONTRACT.md#stale-initial-validated-recovery-с-сохранением-auditstaging-evidence). Это решение разрешает разработку и доказательство gates; оно не вооружает production mutation или existing autocontinue.

Последнее доказанное evidence до wiring historical proof в recovery surface: full read-only recovery [35516186419](https://github.com/kmephis-ai/PrihRash/actions/runs/35516186419) на `f07522512866477df50fab13da828f53264e1461` — `RECOVERY_REQUIRED / VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY`, `AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH` и Gate A blocker `HISTORICAL_CONTEXT_NOT_PROVEN`. Оно не разрешает mutation/replay и подтверждает, что следующий repository step должен использовать уже реализованные historical reconstruction + exact staging/NOT_APPLIED primitives внутри того же read-only recovery surface.

Owner также явно разрешил узкое ослабление Gate A: вместо полного historical projection/reference reconstruction допустима только privacy-safe temporal correlation `swap discrimination reached → invocation completed` **вместе** с отдельным exact `NOT_APPLIED`. Это снижает прежнюю fail-closed гарантию для historical context и применимо только к marker-only terminalization данного stale run; temporal correlation сама по себе, `APPLIED`/ambiguous discriminator, in-flight mutation или competing writer всё ещё оставляют `RECOVERY_REQUIRED`.

Owner 2026-09-20 дополнительно явно принял остаточный risk exception по Gate A condition 6 для exact historical run `35469651936` (`acb40fb81befc548939f72146df729d27d591cbe`) и разрешил продолжать без Yandex Support evidence. Это не превращает unknown SchemeShard outcome в доказанный terminal state: exception действует только для marker-only Gate B terminalization этого run и только при fresh exact `NOT_APPLIED` + всех остальных Gate A predicates внутри непрерывного shared writer lock. Для будущих ambiguous provider mutations provider-completion evidence остаётся обязательным.

Текущая готовность нового contract:

| Gate | Требование | Статус |
| --- | --- | --- |
| A | Historical candidate + exact NOT_APPLIED + provider-mutation risk disposition + single-writer exclusion | PASS ДЛЯ ЭТОГО HISTORICAL RECOVERY: condition 6 закрыт explicit Owner risk exception только для `35469651936`; condition 7 live-доказан Gate B run `35532501283`, который удерживал shared `r1-initial-bootstrap-writer` от fresh preflight через terminal read-back |
| B | Exact marker-only VALIDATED → FAILED с fixed error code и unknown-outcome recovery | LIVE PASS: run `35532501283` на exact main `82680297a44b6b91522c8ecd70eeec4af5cadda4` завершился SUCCESS и прямым `GATE_B_APPLIED`; artifact = `PASS / INITIAL_BOOTSTRAP_STALE_VALIDATED_TERMINALIZED / EXACT_FAILED_MARKER`. Unknown-outcome `RECOVER` не понадобился |
| C | Fresh bootstrap с новыми identities при сохранении старых audit/staging tables | НЕ РАЗРЕШЁН до отдельного gate после B |

Gate B live завершён после exact-main canonical gates. Первый dispatch `35531939160` безопасно остановился **до provider deployment и WRITE** на stale textual guard `GATE_B_FUTURE_STRICTNESS_MISSING`; PR #692 привязал guard к реальной normative формулировке contract и merged в `82680297a44b6b91522c8ecd70eeec4af5cadda4`. Fresh readiness `35532384376` вернул `PASS / READINESS_READY`. Затем Gate B run `35532501283` прошёл authority/provider/exact-main gates, выполнил ровно один marker-only WRITE и вернул прямой `GATE_B_APPLIED`; read-only `RECOVER` не понадобился. Post-commit `diagnoseOutcome` exact-сверил terminal FAILED row и повторно доказал empty canonical current. Marker transaction write surface ограничен `migration_runs`; current/source/reference/staging/schema, swap replay, cleanup и retirement не входили в путь. Existing STAGING retirement workflow не принимает VALIDATED как alias. Gate C остаётся отдельным gate.

Condition 7 закрывается не одним workflow lock. Standalone recovery, initial bootstrap, controlled rebuild, swap-recovery и Gate B execution share `r1-initial-bootstrap-writer`; competing run может только ждать. Gate B workflow `r1-initial-bootstrap-stale-validated-terminalization.yml` сам удерживает этот lock, а его Function handler внутри lock заново выполняет fresh recovery и разрешает marker transaction только при exact owner-exception preflight `VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY + AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH + IN_FLIGHT_PROVIDER_MUTATION_UNKNOWN`. После terminalization queued ordinary bootstrap, получив lock, повторно читает durable marker и fail-closed останавливается на `STALE_VALIDATED_TERMINALIZATION_REQUIRES_GATE_C`; controlled rebuild также не имеет допустимого incomplete continuation run. Unknown marker outcome не разрешает второй WRITE: допускается только read-only durable `RECOVER`. Live run `35532501283` доказал condition 7 для этого Gate B attempt: shared lock удерживался от fresh preflight через exact terminal read-back, а workflow завершился SUCCESS с `EXACT_FAILED_MARKER`.

### Historical provider-completion evidence gap — Gate A condition 6

Investigation 2026-09-20 зафиксировало реальную границу evidence для historical ambiguous swap, не меняя normative Gate A:

- historical controlled run [`35469651936`](https://github.com/kmephis-ai/PrihRash/actions/runs/35469651936) на `acb40fb81befc548939f72146df729d27d591cbe` сохранил только bounded `INITIAL_CONTROLLED_REBUILD_RECOVERY_REQUIRED / SWAP_OUTCOME_AMBIGUOUS`; его phase artifact = `INITIAL_CONTROLLED_REBUILD_PHASE_UNAVAILABLE / LOG_READ_FAILED`;
- full logs/artifacts этого run не содержат сохранённого YDB `session_id`, provider request id, SchemeShard `tx_id` или durable operation id;
- historical `ydbJsV6SchemeTransport` выполнял `RenameTables` с `OperationMode.SYNC`; при unknown transport outcome он сохранял только error taxonomy, а `DeleteSession` был best-effort и не становился recovery evidence;
- YDB server-side `RenameTables` отправляет schema transaction через TxProxy и ждёт SchemeShard transaction completion. Generic gRPC client-loss/operation-timeout path завершает клиентский RPC actor, но не является доказанным cancel/terminalization barrier для уже отправленной SchemeShard transaction. Source references: [`rpc_rename_tables.cpp`](https://github.com/ydb-platform/ydb/blob/981cc88b8600dc5bdd2f3c64f1b95bb446b1de9d/ydb/core/grpc_services/rpc_rename_tables.cpp), [`rpc_scheme_base.h`](https://github.com/ydb-platform/ydb/blob/981cc88b8600dc5bdd2f3c64f1b95bb446b1de9d/ydb/core/grpc_services/rpc_scheme_base.h), [`rpc_deferrable.h`](https://github.com/ydb-platform/ydb/blob/981cc88b8600dc5bdd2f3c64f1b95bb446b1de9d/ydb/core/grpc_services/rpc_deferrable.h), [`ydb_operation.proto`](https://github.com/ydb-platform/ydb/blob/981cc88b8600dc5bdd2f3c64f1b95bb446b1de9d/ydb/public/api/protos/ydb_operation.proto);
- documented `ydb operation list` long-running kinds do not include table rename, so there is no documented generic LRO enumeration route for this lost SYNC operation: [YDB operation list](https://ydb.tech/docs/en/reference/ydb-cli/operation-list);
- Yandex Audit Trails documents YDB management events, but its data-event supported-services list does not list Managed Service for YDB. Therefore current documented Managed YDB Audit Trails surfaces do not provide a read-only historical table-rename completion record for this run: [management events](https://yandex.cloud/en/docs/audit-trails/concepts/events), [data events](https://yandex.cloud/en/docs/audit-trails/concepts/events-data-plane).

Следствие investigation не меняется как факт: retained evidence + documented read-only provider APIs недостаточны, чтобы задним числом доказать завершение/отсутствие ранее отправленной SchemeShard rename transaction. Без Owner exception это классифицируется как `IN_FLIGHT_PROVIDER_MUTATION_UNKNOWN`; истёкшее время, завершение GitHub job/Function, session expiry/delete, два одинаковых topology reads или exact `NOT_APPLIED` сами по себе proof не создают.

Owner 2026-09-20 принял этот остаточный риск **только для exact `35469651936`** и разрешил не ждать Yandex Support. Поэтому condition 6 больше не блокирует marker-only Gate B для этого run после canonicalization решения, но историческая SchemeShard transaction остаётся фактически недоказанной. Condition 7 и все остальные Gate A predicates обязательны; production Gate B должен заново проверить их внутри непрерывного shared lock. Gate C fresh bootstrap, swap replay, cleanup и retirement этим решением не разрешены.

Для будущих write attempts этот gap должен предотвращаться до mutation: recovery contract обязан сохранять durable provider correlation/completion evidence, которое реально можно read-only проверить после transport loss. Это future protocol hardening и не является retroactive proof для `35469651936`.

### Provider support log request — condition 6 evidence acquisition

Официальный Yandex Cloud support path допускает запрос сервисных логов о собственных ресурсах независимо от support plan: [data requests](https://yandex.cloud/en/docs/support/request), [Support Center](https://yandex.cloud/en/docs/support/cloud-center). Для этого historical gap не нужно включать новый Audit Trail или расширять IAM. Managed YDB control-plane Audit Trails не содержит table-rename completion events и не заменяет SchemeShard evidence.

Target historical correlation:

- GitHub run `35469651936`, source SHA `acb40fb81befc548939f72146df729d27d591cbe`;
- workflow window `2026-09-19T21:11:21Z .. 21:13:38Z`;
- controlled Function invocation started approximately `2026-09-19T21:12:29Z`;
- bounded result at `2026-09-19T21:13:29Z`: `SWAP_OUTCOME_AMBIGUOUS`;
- support search window should include a conservative tail after client timeout, for example `2026-09-19T21:12:00Z .. 21:30:00Z`, and explicitly answer whether any matching SchemeShard transaction remained active after that interval.

YDB native audit-log semantics show the evidence shape to request: schema-copy/rename events may contain `component=schemeshard`, `tx_id`, `request_id`, `operation`, `status`, `detailed_status`, database/path context; `status` is the operation completion status with values `SUCCESS`, `ERROR`, or `IN-PROCESS`: [YDB audit log](https://ydb.tech/docs/en/security/audit-log). This does **not** assert that Managed YDB exposes the native audit stream directly to the owner; the supported acquisition route for this historical attempt is a private Yandex Cloud support data request.

The private ticket should bind the exact Managed YDB resource and exact rename/table paths privately and ask support for all matching SchemeShard `RenameTables` / `ALTER TABLE RENAME` records in the target window, including terminal timestamp/status and whether a matching transaction can still become active/apply later. Database IDs, table paths, service-account IDs, returned `tx_id`/`request_id`, raw service logs and provider archive links must not be copied to GitHub.

Condition 6 may be reconsidered only if the returned provider evidence binds to this exact database/operation and proves a terminal server-side state. An exact matching SchemeShard record with terminal `status=SUCCESS` or `status=ERROR`, or an explicit provider statement based on internal state/logs that the matching historical transaction is terminal and cannot later apply, is potentially sufficient subject to exact run/path binding. `IN-PROCESS`, management-event absence, elapsed time, Function/GitHub completion, stable topology reads or exact `NOT_APPLIED` without provider completion proof remain insufficient.

Provider support evidence остаётся предпочтительным способом полностью закрыть historical uncertainty, но после explicit Owner risk acceptance оно больше не является prerequisite для marker-only Gate B **только** по `35469651936`. Для других ambiguous provider writes этот support/provider-completion path остаётся обязательным при отсутствии durable correlation evidence.

## Second bounded attempt and read-only controlled-preparation diagnostic

The second explicit Owner authority (#706) was consumed by controlled run `35559851439` on exact
`b831c24a8a6b2c4de069ce5a2d18cd16a2ecff9c`. Fresh recovery `35559600514` and readiness
`35559762343` were successful before the single invoke. The bounded runtime result was:

`FAIL / INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED / APPLICATION_FAILED / PREPARATION / RECONCILIATION_READ`.

Mandatory post-attempt recovery `35559986097` proved that durable state did not advance:
`STAGING_RUN_PRESENT`, both revision-evidence diagnostics remained `COMPLETE_CURRENT_RUN_ONLY`,
verified current remained empty, source decoding had no blocker and exact revision evidence remained
`EXACT_CURRENT_RUN_MATCH`. Therefore no STAGING→VALIDATED transition, scheme setup, staging
materialization, swap or COMMITTED baseline is proven, and the consumed attempt must not be replayed.

The controlled runtime uses a 10 s YDB ready timeout, 21 s per-read timeout and 25 s transaction
timeout. The failure at `RECONCILIATION_READ` makes the 21 s read boundary a bounded hypothesis,
not proof. Increasing that timeout or any resource cap is not authorized by the diagnostic.

Issue #709 therefore adds a **read-only** mode to the existing recovery-only Function. It is valid
only after the recovery surface itself proves `STAGING_RUN_PRESENT`. The mode reuses the same
authoritative source observation and immutable historical evidence, opens a separate YDB client with
the exact controlled `10s/21s/25s` timeout envelope and calls only
`prepareInitialControlledRebuildContinuation`. It stops before lifecycle transition, scheme setup,
staging/current mutation, swap, commit marker or cleanup.

The diagnostic publishes only
`R1_STAGING_CONTROLLED_PREPARATION_EVIDENCE=<ENUM>`. Live run `35583739017` on exact
`326011d032a0d80cb21fd8472518493d3cd94275` completed successfully as a read-only diagnostic and
returned `YDB_DATA_FAILURE`. This proves the controlled preparation failure is inside the existing
YDB data-transport taxonomy, but it does not prove the direct YDB status `TIMEOUT` and does not by
itself exclude a client-side deadline surfaced under another SDK error code.

Issue #711 therefore tightens only this diagnostic enum. Direct
`QUERY_EXECUTION_YDB_TIMEOUT` remains `YDB_QUERY_TIMEOUT`; every other recognized
`YdbJsV6DataTransportErrorCode` is emitted as the exact privacy-safe token
`YDB_DATA_<existing-code>`, for example `YDB_DATA_QUERY_EXECUTION_FAILED` or
`YDB_DATA_QUERY_EXECUTION_YDB_UNAVAILABLE`. The old aggregate `YDB_DATA_FAILURE`, an impossible
`YDB_DATA_QUERY_EXECUTION_YDB_TIMEOUT`, unknown values and private exception text are rejected
fail-closed. Non-YDB diagnostics remain bounded to
`READY | BASELINE_EXISTS | VALIDATION_BLOCKED | DURABLE_RECONCILIATION_FAILURE |
REVISION_EVIDENCE_FAILURE | PRIVATE_EVIDENCE_FAILURE |
APPLICATION_<InitialBootstrapApplicationErrorCode> | DIAGNOSTIC_FAILED`.
The application token preserves only the already-defined bounded application enum and never exposes
messages, stack traces, row data, query text or provider identifiers.

On exact `6bf5c19cd9491f92a81daf98cbd2f4f47337ca10`, fresh read-only preparation probes
`35596737446` and `35597160968` returned respectively
`YDB_DATA_QUERY_EXECUTION_FAILED` and the older aggregate `APPLICATION_FAILURE`, while the prior
exact-envelope probe `35585891033` had returned `READY`. This proves the preparation boundary is
not a single deterministic 21 s timeout/data-shape failure. Issue #715 narrows only the second
aggregate diagnostic to its exact existing application enum; no third controlled attempt is armed.

This diagnostic does not arm a third controlled rebuild, does not change the 21 s timeout, and does
not expand write/provider authority. Google remains authoritative and YDB remains shadow.

Issue #717 adds observational retry evidence to the same read-only controlled-preparation mode without
changing SDK retry policy, timeout values or resource envelopes. During only the inner preparation YDB
read scope, the runtime subscribes to the public `@ydbjs/retry@6.3.0`
`ydb:retry.attempt.completed` and `ydb:retry.exhausted` diagnostics channels. Subscriber callbacks
are non-throwing, unsubscribe in `finally`, ignore `lastError`, query text, session/node/provider
identifiers and timing/count detail, and reduce the entire observation to exactly one enum:
`UNOBSERVED | NO_RETRY | RETRIED | NON_RETRYABLE | EXHAUSTED | DIAGNOSTIC_FAILED`.
This retry evidence is independent from
`R1_STAGING_CONTROLLED_PREPARATION_EVIDENCE`; it may explain a transient
`YDB_DATA_QUERY_EXECUTION_FAILED` but never changes the preparation result or authorizes replay.

Issue #719 adds one more independent observation to the same read-only scope: the runtime subscribes
only to the `error` callback of `tracing:ydb:query.execute` and classifies the final observed
ExecuteQuery error without publishing its status/code, message, stack, query, parameters,
session/node/transaction identifiers, driver/database/address or attempt count. The bounded evidence is
`UNOBSERVED | ABORT_TIMEOUT | YDB_STATUS | GRPC_STATUS | CLIENT_ERROR | OTHER | DIAGNOSTIC_FAILED`.
The callback reads only `context.error`, is non-throwing and unsubscribes in `finally`; malformed
callback/subscription/unsubscription evidence fails closed as `DIAGNOSTIC_FAILED`. This telemetry does
not change query/retry behavior, the exact `10s/21s/25s` runtime envelope, financial authority or the
ban on a third controlled rebuild attempt.

Issue #721 narrows only the already-proven `GRPC_STATUS` branch. For an actual `ClientError`, the
runtime converts its numeric gRPC code immediately to the corresponding standard status name and
publishes only that name. The numeric code itself, `message`, `details`, `metadata`, stack and all
query/session/provider context remain private. Allowed evidence is the standard non-OK gRPC status
set plus `UNOBSERVED | NON_GRPC | UNRECOGNIZED | DIAGNOSTIC_FAILED`. This is observational telemetry
inside the same `controlled_preparation_only` scope; it does not alter retries, deadlines, resource
limits, financial state or provider authority.

Issue #723 reuses the already-existing `InitialBootstrapApplicationPhase` observer and publishes only
the last allowlisted application phase reached by the same read-only controlled preparation. The
bounded phase evidence is the existing application phase enum plus `UNOBSERVED | DIAGNOSTIC_FAILED`.
No tracing/query context is inspected and no additional YDB/Google read is introduced: the observer is
passed directly to `prepareInitialControlledRebuildContinuation`. This phase evidence is independent
from preparation/retry/query-error/gRPC-status evidence and cannot authorize replay, timeout/resource
changes or any lifecycle mutation.

## Setup and staging recovery

The exact run-scoped target is `rebuild/r_<run-id-without-hyphens>/{transactions|source_records}`. The runtime proves canonical current table presence, the optional `rebuild` parent directory, the exact run directory and the exact staging table pair before mutation. Foreign/wrong-kind/mixed run-scoped scheme evidence fails closed.

If the staging pair is absent, setup may ensure the parent/run directories and issue one two-table `copyTables` operation from the known-empty canonical tables. If the copy outcome is unknown, only `recoverUnknownControlledRebuildCopyOutcome` is allowed. `RECOVERY_REQUIRED` or proven `NOT_APPLIED` stops this invocation; there is no blind copy replay.

Staging data writes use existing bounded batches. If a batch execution becomes unknown/fails, the runtime reads staging evidence and may continue only if the complete exact candidate is already proven. Partial/mismatched staging stops with `STAGING_MATERIALIZATION_INCOMPLETE`; completed batches are not blindly replayed.

## Swap recovery

Before any rename, the runtime executes read-only swap discrimination. If the exact post-swap state is already proven, rename is skipped. If the exact pre-swap state is proven, one atomic two-table `renameTables(... replace=true)` is allowed. Mixed/foreign state stops.

After an unknown rename outcome, only `recoverUnknownControlledInitialSwapOutcome` may classify `APPLIED | NOT_APPLIED | RECOVERY_REQUIRED`. This invocation never blindly issues a second rename. `NOT_APPLIED` and `RECOVERY_REQUIRED` are STOP results for a later separately reconciled action.

## COMMITTED boundary

A swap is not a verified baseline by itself. Exact canonical-current reconciliation must pass before the MigrationRun marker is moved from `VALIDATED` to `COMMITTED`. The marker transition uses its existing optimistic guard. Unknown marker outcome is classified by read-only marker + swap evidence; it is never guessed.

After a proven COMMITTED marker, the runtime performs exact current verification again and the serverless job independently reruns durable committed-current reconciliation. Only then may the public workflow emit:

```json
{"status":"PASS","code":"INITIAL_CONTROLLED_REBUILD_COMMITTED"}
```

All other outcomes are NOOP/STOP/FAIL and remain non-success at the workflow boundary.

## Privacy and retirement

GitHub output/artifacts may contain only exact SHA/run IDs from GitHub and bounded enum-only provider classifications. They must not contain real financial rows, amounts, descriptions/notes, raw Google snapshots, private reconciliation totals, provider identifiers, connection strings or credentials.

After independently proven COMMITTED current state, the temporary WU7 write authority is retired at a natural boundary. The private Function may remain only as trigger-free inert scaffold if canonical cleanup says so. Timer, scheduled sync and cutover remain separately gated.

### #738 read-only reconciliation read-stage evidence

После доказанного serverless throttling `10 RU/s` fresh long-idle controlled-preparation diagnostic снова воспроизвёл `RESOURCE_EXHAUSTED`, но application phase дошла до `RECONCILIATION_READ`. Для этого слоя recovery-only surface может публиковать только последний достигнутый enum `UNOBSERVED | REVISION_METADATA_SCAN | REVISION_PAYLOAD_BATCH | REVISION_COLLISION_READ | DIAGNOSTIC_FAILED`.

Observer отмечается непосредственно перед уже существующими revision metadata scan, byte-bounded exact payload batch read и conditional collision read. Он не добавляет YDB request, не меняет SQL/parameters/order/batch size, retry/timeout/RCU/cap/IAM и не разрешает controlled rebuild replay. Query text, parameters, rows, provider IDs и financial payload в evidence не входят.

### #740 resume snapshot read collapse

Exact-main recovery `35677723728` на `3f464b5e2da62553cecfc501316c9f386c3dae55` завершился как `RESUME_SNAPSHOT_READ / GRPC_STATUS / RESOURCE_EXHAUSTED` после успешного `RESUME_IDENTITY_MANIFEST_READ`. Repository inspection доказал, что identity-manifest query уже JOIN'ит exact `source_snapshots` row и проверяет `snapshot_digest` + `row_count`; следующий `readDurableSnapshot` повторно читал тот же `source_snapshots` row только ради `captured_at` и повторной проверки тех же snapshot facts.

В #740 resume path использует один existing manifest JOIN: query дополнительно возвращает `snapshot_captured_at`, parser fail-closed нормализует YDB Timestamp, а recovered identity evidence передаёт `capturedAt` в candidate reconstruction. Отдельный второй `SELECT ... FROM source_snapshots WHERE id = $id` удалён. Это уменьшает число provider reads/RU pressure без изменения source identity, financial semantics, SQL ordering/batch size reconciliation, retry/timeout policy, IAM, schema/indexes или provider cap.

`RESUME_SNAPSHOT_READ` остаётся allowlisted historical diagnostic enum для уже созданных artifacts/backward-compatible sanitizer contract, но current resume application path больше не создаёт отдельный provider read под этой фазой. После merge разрешён только отдельно gated exact-main read-only `controlled_preparation_only=true` invoke: он должен показать, проходит ли preparation дальше без cap increase. Controlled rebuild replay, staging/swap/cleanup, Google mutation и authority switch этим изменением не разрешены.

### #755 retirement: FULL stats больше не часть обычного controlled-preparation probe

После #744 privacy-safe RU measurement уже выполнил свою stage-specific задачу: он доказал дорогой `REVISION_METADATA_SCAN`, после чего был введён schema-v4 indexed read path. Затем #753/#754 отдельно сузил `REVISION_PAYLOAD_BATCH` до exact source keys. Fresh exact-main read-only recovery `35814646834` всё ещё остановился на `RESOURCE_EXHAUSTED` в `REVISION_PAYLOAD_BATCH`.

При этом repository inspection показал, что диагностический `readRequestUnitObserver` из #744 включал `StatsMode.FULL` на **каждом** standalone YDB read controlled-preparation invocation, хотя наружу учитывался только metadata-scan cost. Это instrumentation больше не требуется для текущей причинной проверки и само делает diagnostic path менее похожим на обычный runtime read path.

Начиная с #755 обычный `controlled_preparation_only` больше не передаёт `readRequestUnitObserver`; следовательно, он не запрашивает FULL query stats для всех reads. Protocol field `stagingControlledPreparationMetadataScanCostEvidence` сохраняется для backward-compatible evidence и штатно возвращает `UNOBSERVED`. Pure RU estimator/tracker и transport capability не удаляются: этот item retire'ит только активное stage-specific wiring.

Это изменение **не** утверждает, что FULL stats был причиной `RESOURCE_EXHAUSTED`, и не ослабляет revision evidence. Exact schema-v4 metadata read, exact-key full `raw_payload` verification, retry/timeout envelope, request ordering/count, IAM и financial semantics остаются прежними. После merge разрешён максимум один fresh exact-main read-only controlled-preparation diagnostic; controlled rebuild replay, cap increase, Google mutation, timer/cutover и production Writer остаются запрещены.

### #758/#759: one-shot temporary 14 RU/s gate

Owner отдельно разрешил ровно один WU7 controlled rebuild с временным повышением serverless throttling `10 → 14 RU/s` и обязательным возвратом на `10`. Эта authority не меняет Google/YDB authority model: Google остаётся authoritative, YDB — shadow; timer/cutover/production Writer не включаются.

Repository surface остаётся внутри существующего manual-only `R1 initial controlled rebuild`. Новый input `temporary_throttling_gate_issue` по умолчанию пуст и не меняет обычное поведение. Если input задан, workflow fail-closed требует отдельный open provider gate с `Provider-Authority: WU7_TEMPORARY_THROTTLING_14` и explicit hard bounds `10 → max 14 → 10`, а controlled-rebuild Issue обязан ссылаться на тот же gate.

Temporary Function package содержит только `wu7TemporaryThrottlingHandler`, использует существующий `prihrash-initial-bootstrap` runtime service account и получает только `PRIHRASH_YDB_CONNECTION_STRING` + folder locator. Google secrets и financial source payload в package не передаются. Workflow не создаёт и не меняет IAM bindings.

Перед mutation handler выполняет exact `Database.Get` identity/state proof: serverless, throttling enabled, `throttlingRcuLimit=10`, `provisionedRcuLimit=0`. `Database.Update` использует только exact field mask `serverlessDatabase.throttlingRcuLimit`; enable/provisioned/storage/network/backup и прочие поля не входят в mutation body. Async provider operation обязана достичь terminal state, после чего отдельный `Database.Get` подтверждает exact target.

После доказанного `14` выполняется ровно один existing controlled-rebuild invoke. Сразу после него `always()` compensation сначала read-only классифицирует current limit: exact `10` означает безопасный no-op, exact `14` требует `Database.Update → 10`. Любая выполненная update operation обязана получить terminal Operation proof, после чего независимый final `Database.Get` подтверждает exact `10 / enabled / provisioned=0`.

Live run `35906947701` на `d58b2606...` доказал отдельный control-plane blocker: initial `10` preflight прошёл, SET и restore оба заняли примерно текущий 120-second Operation envelope и завершились как `UNPROVEN`; controlled rebuild был skipped. Последующий independent `Database.Get` доказал exact final `10 / enabled / provisioned=0`. Это не разрешает считать terminal Operation proof пройденным и не разрешает replay.

Начиная с #761 terminal Operation envelope увеличен до bounded 300 секунд внутри 360-second temporary Function timeout. Runtime различает privacy-safe `OPERATION_READ_AUTH | OPERATION_READ_NOT_FOUND | OPERATION_READ_TRANSPORT | OPERATION_READ_MALFORMED | OPERATION_NOT_TERMINAL`, не публикуя provider IDs/raw errors. Workflow сохраняет отдельные `set-classification.json` и `restore-classification.json`; при restore failure выполняется только независимый read-only final state proof, но success по-прежнему невозможен без terminal Operation.

Unknown/failed set или restore не разрешает replay. Если terminal restore proof/final read не доказан, workflow остаётся failed/recovery-required; cap выше `14`, provisioned RCU change, IAM widening, Google mutation, cleanup ambiguous financial state, timer/cutover и новый controlled rebuild/provider attempt без отдельного Owner decision запрещены.


### #767: terminal Operation proof через Idempotency-Key

Live evidence после #762/#766 локализовал blocker: runtime SA может выполнить exact `Database.Update`, но generic `Operation.Get` не проходит authorization. Временный DB-scoped `auditor` был полностью удалён; provider state возвращён и доказан как exact `10 / enabled / provisioned=0`.

Начиная с #767 temporary throttling handler не использует generic Operation endpoint. Для каждого логического SET/RESTORE создаётся один UUID v4 и передаётся как `Idempotency-Key` в exact `Database.Update`. Повторные bounded poll requests используют тот же method/path/body/key. По documented Yandex Cloud idempotency contract такой повтор не выполняет mutation снова, а возвращает тот же `Operation` с его текущим status.

Terminal proof не ослаблен: success существует только при `done=true` и ровно одном `response`; terminal `error` остаётся failure; изменение operation ID, malformed shape, authorization/not-found, transport exhaustion или bounded non-terminal timeout fail closed. После terminal success отдельный exact `Database.Get` по-прежнему обязан доказать target limit.

Polling envelope остаётся bounded 300 seconds, реализован как максимум 150 identical idempotent PATCH requests с интервалом 2 seconds внутри 360-second temporary Function timeout. Generic `Operation.Get`, temporary `auditor` и любое IAM widening для этого path не требуются.

Repository-only #767 не разрешает новый provider attempt. Новый live `10→14→controlled rebuild→10` возможен только под отдельной fresh Owner authority после merge и exact-main verification.


### #773: proto3 default done=false

Live one-shot `35953332143` после #768 доказал новый control-plane parsing blocker: initial exact 10 PASS, SET и restore оба завершились `UPDATE_MALFORMED`, controlled rebuild был SKIPPED, а final provider read-back остался exact `10 / enabled / provisioned=0`.

Yandex Cloud REST API использует gRPC-JSON transcoding поверх proto3. Для Operation `done=false` означает non-terminal state; `response` отсутствует до successful completion, а `error` может появиться ещё до завершения rollback. Runtime поэтому нормализует отсутствующий JSON field `done` к proto3 default `false`.

Это не ослабляет terminal proof: success по-прежнему существует только при `done=true` и ровно одном `response`; terminal failure — при `done=true` и ровно одном `error`. Omitted/false `done` с `response` остаётся malformed; omitted/false `done` с ранним `error` остаётся non-terminal и продолжает bounded polling тем же Idempotency-Key.

#773 — repository-only. Live provider retry, cap mutation и controlled rebuild требуют новой отдельной Owner authority после merge и exact-main verification.

### #777: ранний response у незавершённой Managed YDB Operation

Новая Owner-authorized попытка `36029010407` после #774 снова вернула `UPDATE_MALFORMED`
на SET и restore; financial invoke был пропущен. Independent read-only run `36029331966`
доказал итоговые `10 RU/s / enabled / provisioned=0`, но не terminal Operation proof.

Причина воспроизведена отдельным bounded no-op `Database.Update` на тестовой YDB:
единственное поле `throttlingRcuLimit` оставалось `10 → 10`. Первый ответ и первый
idempotent poll содержали `done=false` **вместе с объектом `response`**, без `error`.
Следующий poll с тем же UUID, method/path/body вернул ту же Operation с `done=true`
и `response`. Независимый final read подтвердил exact `10 / enabled / provisioned=0`.
Provider identifiers, token и raw response в evidence не публиковались.

Это наблюдаемое поведение Managed YDB отличается от общего описания
[Operation](https://yandex.cloud/en/docs/api-design-guide/concepts/operation), где
`response` описан как поле завершённой операции. Начиная с #777 ранний объект
`response` при omitted/false `done` не является ни terminal success, ни сам по себе
ошибкой формата: продолжается bounded polling тем же idempotency key.
Success по-прежнему требует `done=true`, ровно одного `response` без `error` и
независимого exact Database.Get. Изменившийся operation ID, invalid done type,
необъектный ранний response или одновременные response/error остаются fail-closed.
Ранний response без последующего terminal proof заканчивается `UPDATE_NOT_TERMINAL`;
он никогда не заменяет terminal proof или final read-back. Это уточнение заменяет
запрет любого раннего response в предыдущем разделе #773.

### Post-#778 WU7 result on `c28d6335bfefc68e8ad7f9bb2a00fd4af54d99b8`

The one-shot controlled rebuild `36032087423` ran after #778 with fresh readiness and the exact
staging recovery prerequisite. Its enum-only evidence was
`INITIAL_CONTROLLED_REBUILD_RUNTIME_FAILED / APPLICATION_FAILED / PREPARATION /
RECONCILIATION_READ`. The controlled phase probe was unavailable as
`INITIAL_CONTROLLED_REBUILD_PHASE_UNAVAILABLE / LOG_READ_FAILED`.

The temporary throttling artifacts independently proved `10 → 14`, followed by a successful
restore to exact `10`; the final throttle classification was
`WU7_TEMP_THROTTLING_RESTORED_10`. No successful controlled result or COMMITTED baseline was
established.

Read-only recovery `36032381827` on the same SHA returned only
`RECOVERY_REQUIRED / STAGING_RUN_PRESENT`. That establishes the durable run surface, but does not
classify exact revision evidence, fresh source match, or resumability. The live recovery therefore
does not authorize another controlled rebuild, swap, cleanup, or replay. The next permitted step is
one full read-only exact-revision recovery on a new exact-main SHA using
`Recovery-State: STAGING_PRESENT_UNCLASSIFIED`; its result must independently establish the fresh
source/revision and staging state before any later separately authorized mutation.

The one-shot WU7 authority in #779/#780 was bound to SHA `c28d6335bfefc68e8ad7f9bb2a00fd4af54d99b8`
and was consumed by this run. A successor write-capable attempt requires fresh exact-main
preconditions and a current open authority gate; this checkpoint does not extend or re-arm that
one-shot authority.
