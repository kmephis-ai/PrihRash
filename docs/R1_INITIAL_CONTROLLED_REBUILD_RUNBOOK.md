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

The only allowed next action is the manual read-only `R1 initial controlled rebuild deploy recovery` workflow on exact current `main`. It must bind both the exact current recovery-code SHA and the separate immutable SHA of the failed controlled-rebuild run, prove that the deploy step failed and the controlled invoke step was skipped, re-check the open WU7 authority boundary and verify that no competing R1 writer is active. The failed-run SHA is intentionally separate because recovery tooling may be merged after the failed provider attempt.

Recovery reads Function/version metadata only. The exact tag `r1-initial-controlled-rebuild` is the discriminator:

- no matching tag → `NOT_APPLIED / TAG_ABSENT`;
- exactly one matching `ACTIVE` version with runtime `nodejs22` and entrypoint `index.initialControlledRebuildHandler` → `APPLIED / EXACT_ACTIVE_TAG`;
- Function/version read failure, non-active or mismatched metadata, or ambiguous matching evidence → `RECOVERY_REQUIRED`.

`APPLIED` proves only the Function-version deployment layer. It does not prove that the controlled rebuild handler ran, that YDB staging/swap/marker mutations occurred, or that a verified baseline exists. `NOT_APPLIED` permits a later separately gated deploy retry only after its cause is understood and the exact-main/recovery/readiness gates are refreshed as required. `RECOVERY_REQUIRED` forbids replay.

The deploy-recovery workflow has no Function-version create/invoke command and no Google/YDB mutation authority. Its published artifact is bounded enum-only evidence.

When deploy recovery proves `APPLIED / EXACT_ACTIVE_TAG` and the failed controlled run proves its invoke step was skipped, the already-created version may be reused only through the existing controlled workflow recovery mode. That mode requires a successful deploy-recovery run on the exact current `main`, fresh exact-main recovery `VALIDATED_CURRENT_EMPTY_STAGING_ABSENT`, fresh `READINESS_READY`, and the open WU7 authority gate. It skips Function-version creation, re-reads live version metadata and requires exactly one active `r1-initial-controlled-rebuild` tag with runtime `nodejs22`, entrypoint `index.initialControlledRebuildHandler`, async retries `0`, the expected async service account and no YMQ targets. Only then may it submit one async invocation. HTTP 202 still requires a fresh read-only recovery before any later write.

## Unknown invocation recovery

If the controlled Function invocation itself ends with a transport failure/timeout after the handler may have started, its YDB write outcome is unknown. Do not replay the handler. First run the existing read-only initial-bootstrap recovery on the exact current `main`.

When durable recovery reports `VALIDATED_RUN_PRESENT`, the recovery-only handler refines that state using YDB scheme/current/staging reads only and emits one of these enum reasons without counts, amounts or row content:

- `VALIDATED_CURRENT_EMPTY_STAGING_ABSENT` — validation transition is durable; run-scoped staging tables are absent.
- `VALIDATED_CURRENT_EMPTY_STAGING_EMPTY` — the staging table pair exists but remains empty.
- `VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY` — staging contains data; completeness is not assumed.
- `VALIDATED_CURRENT_NONEMPTY_STAGING_ABSENT` — canonical current is non-empty and staging is absent; swap may have applied, but exact post-swap reconciliation is still required.
- `VALIDATED_CURRENT_NONEMPTY_STAGING_PRESENT` — current and staging are both present; stop for explicit recovery.
- `VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS` or `VALIDATED_CONTROLLED_DIAGNOSTIC_FAILED` — stop; no replay.

These enums are structural evidence only. They do not declare staging completeness, swap success or a verified baseline. Any later continuation remains separately gated and must use the existing exact staging/swap/marker discrimination before its next mutation.

## Async continuation transport

The live WU7 Function may legitimately need longer than a synchronous HTTPS client connection remains reliable. Controlled continuation therefore uses Yandex Cloud Functions asynchronous invocation (`integration=async`) after all exact-main/recovery/readiness/provider-boundary gates pass. The deployed Function version must explicitly enable async invocation with zero provider retries and the already-proven WIF service account as the async invoker identity; no success/failure YMQ target is configured.

Provider metadata proof uses `yc serverless function version get-by-tag --format json-rest`, so both deploy recovery and the immediate pre-invoke postflight validate the same REST-shaped `asyncInvocationConfig`: `retriesCount == 0`, exact async service-account identity, and no YMQ success/failure target. A tag is reusable only when those async settings are proven together with `ACTIVE`, `nodejs22` and `index.initialControlledRebuildHandler`. Runtime/entrypoint/status alone are insufficient for `EXACT_ACTIVE_TAG`.

An HTTP `202` is classified only as:

```json
{"status":"PASS","code":"INITIAL_CONTROLLED_REBUILD_ASYNC_ACCEPTED"}
```

This proves only that Yandex Cloud accepted the invocation request. It does **not** prove that the Function completed, that staging materialization or swap occurred, or that a verified baseline exists. The workflow must not emit `INITIAL_CONTROLLED_REBUILD_COMMITTED` from async acceptance.

After async acceptance, no second controlled invocation is allowed until a fresh read-only recovery on the same exact-main lineage classifies the durable YDB state. The recovery evidence, not HTTP completion, selects the next action.

A previously unknown synchronous invocation may be continued asynchronously only when read-only recovery has proven `VALIDATED_CURRENT_EMPTY_STAGING_ABSENT`: durable validation is present, canonical current remains empty and the run-scoped staging pair is absent. This prevents replay across an ambiguous setup/staging/swap boundary.

## Controlled path

The runtime reuses existing WU7 primitives and the durable bootstrap identity/revision evidence:

`exact STAGING/VALIDATED continuation → bounded staging setup → bounded staging batches → staging reconciliation → read-only swap discrimination → at most one atomic two-table swap → exact current verification → COMMITTED marker → exact post-commit verification`.

The ordinary calibrated promotion cap is unchanged. Controlled staging batches are individually rechecked by the same calibrated atomic preflight. No transaction is enlarged merely to force the bootstrap through.

The deterministic transaction timestamp for the reconstructed controlled candidate is the durable `MigrationRun.startedAt`. A continuation therefore rebuilds the same current-write candidate instead of inventing a new timestamp on each recovery attempt.

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
