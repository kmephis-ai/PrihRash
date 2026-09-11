# R1 YDB schema upgrade 003: provider runbook

Этот runbook — отдельный one-shot production DDL gate перед **первым real initial shadow bootstrap**. Он существует после завершённых #302/#441: production YDB уже доказана на exact financial migrations `001..002`, но canonical initial-bootstrap resume protocol требует durable `initial_bootstrap_identity_manifests`, создаваемую только migration `003_initial_bootstrap_identity_manifest.sql`.

Migration `003` содержит только operational identity/resume evidence table. Она не пишет Google source rows, canonical Transactions, current shadow state, auth DDL или timer configuration.

## Authority boundary

Live apply **не выполняется автоматически** после merge repository change. Он требует отдельного Owner/provider-write решения для #448.

Разрешён ровно transition:

```text
schema_migrations exact 1+2
+ initial_bootstrap_identity_manifests absent
→ apply canonical 003
→ INSERT exact ledger version 3/checksum
→ exact ledger + physical schema read-back
```

Exact already-ready `1+2+3` + valid physical manifest table является read-only no-op. Любой другой state fail-closed.

Запрещены:

- migration `001`, `002`, `004+`;
- `db/auth/*`;
- Google source reads;
- financial candidate/current writes;
- timer/trigger creation;
- R2/R3 provider deploy;
- authority cutover;
- reactivation/reuse retired #441 identities без отдельного provider decision.

## Repository boundary

Canonical migration:

```text
db/migrations/003_initial_bootstrap_identity_manifest.sql
```

Exact current checksum:

```text
3 → sha256:da569cc8b8bb4772713baf60196a32741b5b704bdb979d1ee60fe40dccb4df06
```

Applied immutable predecessor checksums expected by the one-shot runtime:

```text
1 → sha256:13afb6e86e790320efa66ca57a3f7771bdf4b0bba503f917f58b3e6952599855
2 → sha256:4d746e22e4db2327af0503d7be627741249d9bb9b8a5ca31d826a4ce526b84ed
```

Dedicated package:

```text
.artifacts/yandex-schema-upgrade-003-function
```

Он содержит только migration `003` и exact runtime dependencies. В нём физически отсутствуют migration `001/002/004+`, auth DDL, scheduled-sync runtime и Google source runtime.

## Provider resources

Для live apply Owner создаёт отдельный временный least-privilege surface; retired #441 resources не реактивируются молча.

### Private Function

```text
prihrash-r1-schema-upgrade-003
```

Требования:

- public invocation выключен;
- triggers = 0;
- logging выключен;
- runtime `nodejs22`, 128 MiB, timeout 120s;
- entrypoint `index.schemaUpgrade003Handler`;
- workflow создаёт version только с tag `r1-schema-upgrade-003`.

### Runtime service account

```text
prihrash-schema-upgrade-003
```

На время live apply:

- `ydb.editor` только на target YDB database;
- `lockbox.payloadViewer` только на dedicated upgrade secret;
- `kms.keys.encrypterDecrypter` только на конкретный key, если dedicated secret использует customer-managed KMS.

Не выдавать folder/cloud `editor`, `admin`, `ydb.admin`, Google source access или readiness secret access.

### Dedicated Lockbox secret

```text
prihrash-r1-schema-upgrade-003
```

Current version содержит ровно один required key:

```text
ydb_connection_string
```

Не переиспользовать readiness secret с Google credentials и не передавать connection string через GitHub input/env/plaintext.

### GitHub deployment identity + WIF

```text
prihrash-github-schema-upgrade-003
```

Deployment identity не получает `ydb.editor`/Lockbox payload. Она получает только minimum metadata lookup, deployment/invoke permission на dedicated Function и право attach dedicated runtime SA.

WIF subject только:

```text
repo:kmephis-ai@310519475/PrihRash@1359286840:ref:refs/heads/main
```

GitHub repository locators:

```text
YC_R1_SCHEMA_UPGRADE_003_WIF_SERVICE_ACCOUNT_ID
YC_R1_SCHEMA_UPGRADE_003_LOCKBOX_SECRET_ID
```

Они являются locator IDs, не credentials, но не публикуются в Issue/PR/log evidence.

## Canonical workflow

```text
.github/workflows/r1-ydb-schema-upgrade-003.yml
```

Workflow:

1. только `workflow_dispatch` из canonical `main`;
2. проверяет exact repo/ref/SHA и выполняет literal `npm run check`;
3. получает GitHub OIDC и fail-closed сверяет exact issuer/audience/subject;
4. WIF exchange даёт short-lived IAM token dedicated deploy identity;
5. проверяет dedicated Function private + triggers=0;
6. exact lookup runtime SA и dedicated Lockbox secret без публикации IDs;
7. deploy exact `.artifacts/yandex-schema-upgrade-003-function`;
8. server-side inject только `PRIHRASH_YDB_CONNECTION_STRING`;
9. повторно проверяет private + triggers=0;
10. вызывает только tag `r1-schema-upgrade-003` через `npm run schema-upgrade-003:invoke`.

Workflow не имеет `push`, `pull_request`, `schedule`, `repository_dispatch` и не создаёт trigger/timer.

## Apply state machine

Перед DDL runtime выполняет table-independent YDB health read и читает exact migration ledger.

Допустимы только:

1. **Pending 003** — exact versions `1,2` с canonical applied checksums и physical `initial_bootstrap_identity_manifests` отсутствует.
2. **Already ready** — exact versions `1,2,3` с canonical checksums и physical manifest table/required columns существуют.

Fail-closed:

- missing/duplicate/malformed versions;
- wrong checksum predecessor/003;
- version `4+`;
- manifest table уже существует без ledger 3;
- ledger 3 существует без valid physical manifest table;
- provider read status нельзя безопасно классифицировать;
- partial apply/evidence state.

Нельзя использовать `IF NOT EXISTS`, вручную дописывать ledger или удалять table для обхода failure code.

## Safe result

PASS wrapper:

```json
{"status":"PASS","code":"SCHEMA_UPGRADE_003_READY"}
```

Только для exact Function result:

```json
{"ydbSchema":"READY","appliedMigrationVersions":[1,2,3]}
```

Runtime safe markers включают:

- `SCHEMA_UPGRADE_003_RUNTIME_CONFIG_INVALID`
- `SCHEMA_UPGRADE_003_MIGRATION_BUNDLE_INVALID`
- `SCHEMA_UPGRADE_003_YDB_CLIENT_CREATE_FAILED`
- `SCHEMA_UPGRADE_003_YDB_HEALTH_READ_FAILED`
- `SCHEMA_UPGRADE_003_YDB_ACCESS_DENIED`
- `SCHEMA_UPGRADE_003_YDB_PREFLIGHT_READ_FAILED`
- `SCHEMA_UPGRADE_003_PARTIAL_SCHEMA_STATE`
- `SCHEMA_UPGRADE_003_UNEXPECTED_MIGRATION_EVIDENCE`
- `SCHEMA_UPGRADE_003_APPLY_FAILED`
- `SCHEMA_UPGRADE_003_EVIDENCE_FAILED`
- `SCHEMA_UPGRADE_003_FINAL_READBACK_FAILED`
- `SCHEMA_UPGRADE_003_YDB_CLIENT_CLOSE_FAILED`

Raw provider/YDB issues, IDs, endpoint/path, secret payload и query rows не публикуются.

## Post-apply read-only gate

После `SCHEMA_UPGRADE_003_READY`:

1. fresh reconcile exact `main`;
2. manual canonical `R1 Yandex readiness` из exact current `main`;
3. требовать exact `READINESS_READY` с `requiredMigrationVersion=3`;
4. readiness физически проверяет `initial_bootstrap_identity_manifests` required columns;
5. только после этого выполнить retirement temporary migration-003 authority.

## Retirement

До initial shadow bootstrap:

- снять `ydb.editor` с `prihrash-schema-upgrade-003`;
- снять dedicated `lockbox.payloadViewer` и KMS role, если была;
- удалить/disable dedicated federation binding для `prihrash-github-schema-upgrade-003`;
- deactivate/delete dedicated upgrade secret и Function либо оставить только inert private trigger-free recovery scaffold без write/payload authority;
- удалить GitHub WIF locator, когда corresponding identity retired.

Retirement — Owner/provider-admin boundary. Workflow не получает IAM-admin authority для самоотзыва.

## Exit

Initial shadow bootstrap разрешён **только после**:

```text
SCHEMA_UPGRADE_003_READY
→ fresh READINESS_READY(requiredMigrationVersion=3)
→ temporary migration-003 write authority retired
```

Это не делает YDB authoritative: до cutover Google остаётся единственной write authority.
