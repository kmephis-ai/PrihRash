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

### Read-only recovery autocontinue for active R1 #453

Для stage-specific устранения повторяющегося ручного `Run workflow` существует отдельный
`r1-initial-bootstrap-recovery-autocontinue.yml`. Он не является новым финансовым writer и не
расширяет provider authority.

Workflow может dispatch только canonical `R1 initial bootstrap recovery` после successful
push-CI exact current `main` и только когда единственный merged source PR имеет exact markers:

- `Recovery-Attempt: READY`;
- `Provider-Attempt: NOT_AUTHORIZED`;
- `Expected-Recovery-Evidence: EXACT_CURRENT_RUN_CLASSIFICATION`;
- `Recovery-State: STAGING_RESUMABLE`;
- regression test exact path для recovery-autocontinue contract.

Перед dispatch он повторно проверяет exact current `main`, active Issue #453, отсутствие уже
существующего recovery run на этом SHA и отсутствие queued/in-progress orchestrator/bootstrap writer.
Он не dispatch'ит readiness, bootstrap или orchestrator.

Retirement condition: после закрытия Issue #453 workflow обязан operationally safe-stop на
`R1_BOOTSTRAP_RECOVERY_AUTOCONTINUE_ISSUE_INACTIVE`; после natural R1 boundary его следует удалить
вместе с остальным stage-specific R1 provider scaffolding, если он больше не нужен для диагностики.

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
- memory `256m`;
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
- `iam.serviceAccounts.user` только в объёме, необходимом для attachment `prihrash-initial-bootstrap` к Function version;
- `lockbox.viewer` только на dedicated bootstrap secret для lookup metadata/current version.

Folder-scoped `functions.auditor` — единственное намеренное расширение metadata visibility за пределы dedicated Function: Yandex Cloud trigger-list API перечисляет triggers на уровне folder, а workflow fail-closed фильтрует этот список по exact Function ID. Не заменять эту роль на `functions.viewer`, `functions.editor`, primitive `viewer`/`auditor` или более широкую folder/cloud authority.

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

Recovery-only version получает только Google readonly credentials + `ydb_connection_string`; private historical bootstrap evidence в неё не передаётся.

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

Если durable classification точно равна `RESIDUAL_REFERENCE_STATE_WITHOUT_RUN`, тот же recovery invocation выполняет один fresh authoritative Google read через canonical `Ответы на форму (11)` A:K reader и Google readonly scope. Он использует только `google_spreadsheet_id`, `google_service_account_email`, `google_service_account_private_key` и `ydb_connection_string` из уже существующего dedicated Lockbox secret; private historical bootstrap evidence в recovery Function не передаётся. Для любого другого durable reason Google не читается.

Поскольку этот stage-specific recovery path теперь выполняет тот же full authoritative Google snapshot read, что initial bootstrap, recovery Function использует тот же доказанный source-read resource envelope: memory `256m`, execution timeout `150s`; sanitized invoker допускает до `180s`, чтобы provider timeout завершился раньше transport deadline. Это не расширяет write authority и применяется только к read-only recovery tag.

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

После provider-complete Google всё ещё authoritative, timer всё ещё выключен, YDB остаётся shadow. Следующая крупная runtime/authority boundary требует отдельного rolling-wave decision; этот runbook её не разрешает.