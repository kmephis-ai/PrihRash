# R1: первый initial shadow bootstrap Google → YDB

Статус этого runbook: manual-only provider gate для #453. Он не включает timer, cutover или передачу authoritative роли YDB.

До завершения bootstrap и отдельного будущего cutover действует финансовая истина:

`Google authoritative → YDB shadow`.

Authoritative transactional source остаётся только `Ответы на форму (11)`.

## Что делает этот gate

Один ручной запуск `R1 initial shadow bootstrap`:

1. работает только из `main` canonical repository `kmephis-ai/PrihRash`;
2. выполняет canonical `npm run check` и собирает dedicated bootstrap-only Function artifact;
3. fail-closed требует закрытый #433, защищённый `main` и current `main SHA == GITHUB_SHA`;
4. требует успешный manual `R1 Yandex readiness` на **том же exact SHA**;
5. через dedicated WIF deployment identity проверяет заранее подготовленную private trigger-free Function, runtime service account и dedicated Lockbox secret;
6. создаёт только новую version dedicated initial-bootstrap Function;
7. ещё раз проверяет private + triggers=0 и exact current `main`;
8. один раз вызывает exact tag `r1-initial-bootstrap` с `--retry 0`;
9. считает успехом только sanitized `INITIAL_BOOTSTRAP_COMMITTED`;
10. после доказанного успеха временная bootstrap authority должна быть retired до любых timer/scheduled-sync действий.

Workflow **не создаёт** IAM roles, service accounts, secrets, Function, triggers или timers. Provider resources и least-privilege bindings создаются Owner/provider-admin отдельно и только после quality gate #433.

## Жёсткая граница #433

До закрытия #433 запрещены setup/deploy/invoke provider resources этого gate.

Сам workflow дополнительно проверяет перед OIDC exchange:

- Issue #433 имеет `state=closed`;
- GitHub сообщает `main.protected=true`;
- current `main` указывает на exact `GITHUB_SHA` workflow run;
- для exact `GITHUB_SHA` существует successful `R1 Yandex readiness`, запущенный через `workflow_dispatch` из `main`.

Перед `function version create` и ещё раз перед bootstrap invoke workflow повторно читает current `main` и останавливается, если SHA изменился.

Это означает, что repository-side workflow можно review/merge заранее, но current незакрытый #433 структурно блокирует live provider boundary.

## Dedicated provider resources

Имена:

- Function: `prihrash-r1-initial-bootstrap`;
- runtime service account: `prihrash-initial-bootstrap`;
- Lockbox secret: `prihrash-r1-initial-bootstrap`;
- GitHub deployment service account: `prihrash-github-initial-bootstrap`;
- Function tag: `r1-initial-bootstrap`.

Function должна быть:

- private;
- triggers = 0;
- logging disabled;
- runtime `nodejs22`;
- memory `256m`;
- execution timeout `150s`;
- entrypoint `index.initialBootstrapHandler`.

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

Function получает server-side bindings:

- `PRIHRASH_GOOGLE_SPREADSHEET_ID` ← `google_spreadsheet_id`;
- `PRIHRASH_GOOGLE_SERVICE_ACCOUNT_EMAIL` ← `google_service_account_email`;
- `PRIHRASH_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` ← `google_service_account_private_key`;
- `PRIHRASH_YDB_CONNECTION_STRING` ← `ydb_connection_string`;
- `PRIHRASH_INITIAL_BOOTSTRAP_PRIVATE_HISTORICAL_EVIDENCE` ← `initial_bootstrap_private_historical_evidence`.

Private historical evidence parser fail-closed проверяет exact schema, range coverage и совместимость с фактическим количеством leased source rows.

## Deployment artifact

Canonical command:

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

Verifier требует bootstrap-only `dist/runtime` surface и запрещает scheduled/readiness/schema Function runtimes и schema-bootstrap YDB client.

## Fresh readiness перед live bootstrap

После merge final #453 source в `main`, закрытого #433 и provider setup:

1. прочитать exact current `main`;
2. вручную запустить canonical `R1 Yandex readiness` из `main`;
3. дождаться successful workflow run на этом exact SHA;
4. не менять `main` между readiness и bootstrap;
5. только затем вручную dispatch `R1 initial shadow bootstrap`.

Если `main` изменился, bootstrap workflow остановится. Нужен новый readiness на новом exact SHA.

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
FAIL / INITIAL_BOOTSTRAP_INVOKE_OUTPUT_INVALID
```

`VALIDATION_BLOCKED` может вернуть только allowlisted blocker taxonomy и optional allowlisted reconciliation check. `RECOVERY_REQUIRED` возвращает только allowlisted recovery reason. Run IDs, source IDs, row counts, amounts, raw payload, descriptions, provider exception text и credentials наружу не возвращаются.

`BASELINE_EXISTS` — безопасный NOOP, но **не** доказательство, что этот workflow выполнил первый bootstrap; invoker завершает его non-zero.

`CONTROLLED_REBUILD_REQUIRED` запрещает auto-rebuild и автоматическое повышение cap.

## Failure / retry policy

Не делать blind retry.

- Если workflow остановился **до** шага `Invoke exact initial bootstrap tag once`, финансовый bootstrap invocation не начинался. После устранения причины допустим новый manual run с новым exact-main/readiness reconciliation; ранее созданная private trigger-free Function version сама по себе финансовых writes не делает.
- Если invoke step начался, либо получен `RECOVERY_REQUIRED`, либо outcome не доказан, повторный bootstrap запрещён до чтения durable migration state и отдельного bounded recovery decision.
- Unknown provider/transport detail не интерпретировать как success или safe replay.
- Не выполнять controlled rebuild автоматически.

## Privacy-safe evidence после PASS

В Issue/PR можно фиксировать только:

- exact source SHA;
- readiness workflow run = success;
- bootstrap workflow run = success;
- sanitized code `INITIAL_BOOTSTRAP_COMMITTED`;
- факт независимого reconciliation PASS;
- факт retirement temporary authority.

Не публиковать реальные rows, totals, amounts, descriptions, notes, raw Google snapshots, private historical ranges/month mapping, credentials, Lockbox payload или provider IDs.

## Retirement после successful bootstrap

До timer/scheduled sync удалить usable temporary write path:

1. снять `ydb.editor` с `prihrash-initial-bootstrap` на target database;
2. снять dedicated `lockbox.payloadViewer`;
3. снять temporary folder-scoped `functions.auditor` с `prihrash-github-initial-bootstrap`;
4. снять exact KMS role, если он был нужен этому secret;
5. деактивировать dedicated Lockbox secret;
6. отвязать/delete dedicated WIF federated credential для `prihrash-github-initial-bootstrap`;
7. удалить GitHub locator `YC_R1_INITIAL_BOOTSTRAP_WIF_SERVICE_ACCOUNT_ID` после retirement соответствующей identity;
8. dedicated Function удалить либо оставить только как private trigger-free recovery scaffold без YDB write/secret payload authority.

Deployment service account можно оставить без usable WIF binding либо удалить позже отдельным cleanup. `YC_R1_INITIAL_BOOTSTRAP_LOCKBOX_SECRET_ID` сам по себе не credential; после деактивации secret его removal из GitHub — optional cleanup, не retirement gate.

Retirement — Owner/provider-admin boundary. Workflow намеренно не получает IAM-admin authority для self-revoke.

## Exit boundary #453

#453 может считаться provider-complete только когда доказаны все пункты:

```text
#433 closed + main protected
→ exact current main
→ fresh READINESS_READY on exact SHA
→ one manual private trigger-free bootstrap invoke
→ INITIAL_BOOTSTRAP_COMMITTED
→ independent post-COMMITTED reconciliation PASS
→ temporary bootstrap authority retired
```

После этого Google всё ещё authoritative, timer всё ещё выключен, YDB остаётся shadow. Следующая крупная runtime/authority boundary требует отдельного rolling-wave decision; этот runbook её не разрешает.
