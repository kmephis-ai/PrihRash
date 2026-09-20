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
