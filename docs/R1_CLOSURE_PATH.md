# R1 Closure Path — внешний read-only probe

## Current verified checkpoint — 2026-10-10 (supersedes historical probe statuses below)

- Protected `main=05a6176b4a0710ebeafaf3225ebd8e2a5b4cb8e4`; post-merge CI `38047386232`, Browser Quality `38047386236`, Push `38047386022`: PASS.
- Exactly one Owner-authorized hosted read-only probe `38048326549` emitted the actual runtime marker `R1_DIRECT_PROBE=READ_ONLY_SELECT_OK`. Exact GitHub OIDC/WIF, `Database.Get`, provider DSN validation, YDB SDK and literal `SELECT 1` succeeded. No financial rows were queried. This is **data-plane reachability only**, not a financial baseline.
- A one-time exact-database `ydb.viewer` grant was retired (CLI exit 0). Independent provider ACL read-back: original two bindings preserved, GitHub WIF target **zero** bindings. The single-use grant/probe authority is **CONSUMED**; another grant cannot be inferred from a general continuation request.
- Durable `migration_runs` state is **not freshly classified** by `SELECT 1`. Historical full recovery `36770812477` reported `RECOVERY_REQUIRED / STAGING_RUN_PRESENT` with `STALE_STAGING_CURRENT_STATE_EMPTY`; this is not proof of the current state, retirement eligibility or a `COMMITTED` baseline.
- The existing `r1-initial-bootstrap-recovery.yml` invokes `yc serverless function version create` when `reuse_deploy_attempt_run_id` is empty, **including** `surface_only`. A nonempty reuse field has separate exact-version gates; presence of an old recovery Function version alone does not satisfy them. Do not dispatch either route as an assumed read-only YDB state query.
- Provider incident 2092 still restricts resource creation at the latest verified 2026-10-10 09:00 MSK notice. Previously granted recovery-only `CreateVersion` authority remains unconsumed but **HELD** until official release plus exact source/provider/recovery gates.
- Next bounded step: a newly authorized, demonstrably side-effect-free read-only **durable-state** discriminator against the existing DB, emitting only safe lifecycle enums for `STAGING/VALIDATED/COMMITTED` and exact lineage/current-state classification. It must not log private financial rows/IDs/totals, create Function versions, invoke a potentially write-capable Function, grant IAM implicitly, retire staging, or launch bootstrap. Unknown state remains a recovery stop.
- `COMMITTED(A)=NOT_PROVEN`; Google stays authoritative. On later proven recovery and separate writer gate, follow the canonical immutable cutoff A / independent promotion reconciliation / Google catch-up contract.

## Контекст

R1 #630 не получил первый доказанный COMMITTED. Во время Yandex Cloud incident 2092
создание новой версии Function заблокировано. Проверяем отдельный способ исполнения
существующего Node.js движка без создания новой Function.

## Область текущей проверки

scripts/r1-direct-runner-readonly.mjs:
- применяет краткоживущий IAM access token через YDB SDK;
- подключается к существующей базе по grpcs;
- выполняет только SELECT 1;
- не читает финансовые строки и не изменяет YDB, IAM или provider state;
- при ошибках выводит только CONNECT_FAILED либо QUERY_FAILED без сырых текстов.

Входы — только переменные окружения:
PRIHRASH_YDB_CONNECTION_STRING, PRIHRASH_R1_YDB_IAM_TOKEN.
Токен нельзя публиковать в GitHub logs, issue или shell command line.

Node.js >=22, запуск: node scripts/r1-direct-runner-readonly.mjs.
READ_ONLY_SELECT_OK — только подтверждение транспорта/доступа.
Ни один результат этого probe не разрешает production bootstrap.

## Следующая граница

После успешного read-only SELECT обязательны:
1. read-only durable recovery текущего STAGING с доказательством lineage;
2. проверка доступной identity и минимальных database-scoped полномочий;
3. отдельное разрешение и single-writer gate перед любой YDB mutation;
4. переиспользование src/runtime/initialBootstrapReferenceAwareJob.ts
   и src/migration/initialBootstrapApplication.ts, без второго импортёра;
5. independent reconciliation, COMMITTED(A), затем Google catch-up.

Provider-Incident-Hold для CreateVersion не снимается.
Pending one-shot CreateVersion authority не расходуется.

## Read-only evidence, 2026-10-08 (домашний Windows host)

- GitHub current main at probe start: 4e4b149153b63603f54ebd906cb345032edb0071.
- prihrash-prod and prihrash-test: Yandex API status RUNNING.
- Both existing YDB endpoints: TCP/2135 reachable.
- Installed SDK imports: PASS.
- Actual short-lived IAM-token Node probe to prod: CONNECT_FAILED_TRANSPORT.
- No YDB reads of financial data, application writes, Function creation or IAM mutation.
- New focused tests: 2 PASS / 0 FAIL on local Node 24.
- Full npm run check under local Node 24 is NOT canonical: unrelated existing Node
  deprecation warnings and workflow fixture assertions caused failures.
  Repository requires Node >=22 <23. Before merge check canonical Node 22 CI.

**Decision:** do not run direct bootstrap from this host. Next justified experiment is
the same read-only SELECT from a GitHub-hosted Node 22 runner with short-lived WIF identity
and exact existing database metadata. If IAM is insufficient, stop and separately
design a time-bounded database-scoped read authority. Do not widen identity implicitly.

## GitHub-hosted альтернативный сетевой маршрут

Manual-only workflow `.github/workflows/r1-direct-ydb-readonly.yml` использует
существующую GitHub OIDC → Yandex WIF identity. Первые два historical
запуска (`37829722475`, `37921856585`) использовали `Database.List(folderId)`
и завершились `YDB_METADATA_PERMISSION_DENIED` до `Driver.ready()` / `SELECT 1`.

Следующий versioned workflow (после incident postmortem) **не перечисляет
базы каталога**, а использует Yandex REST `Database.Get(databaseId)` по
отдельному приватному exact-ID locator из GitHub Actions secret
`YC_R1_DIRECT_YDB_DATABASE_ID`. Этот secret **отсутствует** в GitHub на
момент подготовки изменения и **не создаётся автоматически**. При отсутствии
или невалидном ID workflow завершается до OIDC:
`R1_DIRECT_PROBE=EXACT_DB_ID_SECRET_MISSING` либо `EXACT_DB_ID_INVALID`.
Успешный `Database.Get` обязан отдельно подтвердить exact ID, folder ID,
имя `prihrash-prod`, `RUNNING`, endpoint и locationId. Ответ API, IDs,
строки подключения и токены не печатать в логи. `401/403` остаётся
`YDB_METADATA_PERMISSION_DENIED`, `404` — `DB_NOT_FOUND`; без
неявного fallback на `Database.List` и без расширения IAM.

Выполнение новой версии **не разрешено** текущим consumed IAM decision:
нужны отдельно согласованные secure provisioning private locator,
новая Owner-authorized scoped IAM permission при необходимости,
интервал распространения IAM не менее 60 секунд после ACL read-back,
exact-current-main/CI/single-writer/provider preflight и затем ровно
один manual read-only probe. Никаких финансовых данных и provider write.
Даже `READ_ONLY_SELECT_OK` не доказывает `COMMITTED`.

Документация точечного GET:
https://yandex.cloud/ru/docs/ydb/api-ref/Database/get

## Следующий bounded gate после `37829722475` — database-scoped read authority

**Доказанный provider result:** manual GitHub-hosted read-only probe `37829722475` на exact
`main ab08bf6e1257ef097d0baa1adcf31e22b9d49598` завершился
`R1_DIRECT_PROBE=YDB_METADATA_PERMISSION_DENIED` в шаге YDB `Database.List`.
Exact-main preflight, Node 22, locked dependencies, synthetic-focused test и GitHub OIDC/WIF
token exchange прошли. Ни `Driver.ready()`, ни `SELECT 1` не достигнуты; следовательно,
ни YDB transport, ни permissions на сам data-plane SELECT этим run не классифицированы.

**Независимая read-only IAM reconciliation** для того же provider identity:
`prihrash-github-initial-bootstrap` = ACTIVE; `prihrash-prod` = RUNNING.
У этой exact service account прямых database-scope bindings `0`, на folder scope
единственная прямая роль `functions.auditor`, на cloud scope прямых назначений `0`.
У БД существуют два bindings на **другие** service accounts (`ydb.viewer`,
`ydb.editor`); они не дают WIF-деплойной identity прав на чтение YDB.
Вывод касается проверенных прямых и наследуемых назначений этой identity; не является
разрешением менять IAM. Evidence в GitHub сохранять только как counts/role names, без
principal/database IDs, connection strings, токенов, значений Secret или financial rows.

**Исторический decision point — `BLOCKED_NEEDS_EXPLICIT_DATABASE_READ_AUTHORITY`:**
один scoped, временный grant `ydb.viewer` на конкретную `prihrash-prod` существующей
`prihrash-github-initial-bootstrap` даёт **реальную возможность читать финансовые строки**
через data-plane. Его нельзя выдавать без отдельного informed Owner decision: разрешение
на `CreateVersion` не распространяется на IAM. Owner выдал **ровно одно** такое разрешение
2026-10-09; попытка и обязательный retirement уже выполнены, см. terminal evidence ниже.
Это разрешение **израсходовано**. До нового Owner decision нельзя повторять grant/probe,
расширять IAM, имперсонировать нового principal, использовать Owner IAM token либо
переносить connection string в GitHub event input/log/issue.

Только после **нового отдельного** Owner-разрешения следующий bounded Incident-M
обязан до IAM mutation доказать: exact current `main`, canonical CI PASS, active
tracking Issue, отсутствие writer conflict, exact SA/DB IDs приватно, текущую ACL
и отсутствие duplicate grant. Использовать только **добавление одной exact binding**
(`add-access-binding`), не folder/cloud-wide role и не `set-access-bindings`,
которая заменяет весь ACL. Сразу после verified grant не запускать probe: согласно
официальной документации Yandex Cloud распространение IAM permissions может занимать
**до минуты**; будущий authorized plan должен включать как минимум 60 секунд
settling time после read-back до единственного read-only probe. Это снижает
вероятность ложного denial, но **не доказывает** эффективные права; scope
`Database.List(folderId)` может отличаться от exact database resource. Заранее
проверить, можно ли использовать `Database.Get` по приватному exact DB ID вместо
folder-wide enumeration, без широкого IAM и без публикации private locators.
Unknown outcome = read-only recovery, не blind delete/regrant. Probe остаётся
manual/exact-main/one-shot, не импортирует финансовые данные, не публикует SQL rows.
После evidence — retirement **только собственной** binding и независимый ACL read-back.

Переходы конечны:
- `YDB_METADATA_PERMISSION_DENIED` даже после proven scoped grant → STOP,
  без расширения роли на folder/cloud;
- `CONNECT_FAILED_*` / `QUERY_FAILED_*` → классифицировать конкретную
  networking/auth/SDK boundary, без new provider write;
- `READ_ONLY_SELECT_OK` → только reachability proof. Затем доказать
  recovery состояния `STAGING` / source lineage и отдельно gated
  initial-bootstrap writer; `COMMITTED` по `SELECT 1` не объявлять.

`Provider-Incident-Hold: ACTIVE` по incident 2092 по-прежнему блокирует
`CreateVersion`, а уже выданный Owner one-shot CreateVersion остаётся
`GRANTED/PENDING_HOLD_CLEARANCE`, не расходуется этим исследованием.

## Terminal evidence: temporary database viewer trial (2026-10-09)

Authority: #630 comment `6079632335`; postmortem evidence: #630 comment
`6079713439`. Current one-shot `R1_TEMP_EXACT_DB_VIEWER_FOR_SINGLE_READONLY_PROBE`
is **CONSUMED**, separate from the pending `CreateVersion` permission.

1. Before grant: existing `prihrash-prod` RUNNING, WIF SA ACTIVE, exactly 2
   database ACL bindings belonging to other accounts, target SA 0.
2. One database-only `ydb.viewer` grant with `--retry 0` returned exit 0.
   Independent ACL read-back: 3 bindings, exactly 1 target-SA viewer;
   original 2 unchanged.
3. One GitHub-hosted manual probe `37921856585`, exact
   `main 12b1212405bca67d014627948c0990c24e4105ba`, completed FAILURE
   with `R1_DIRECT_PROBE=YDB_METADATA_PERMISSION_DENIED` at
   `Database.List(folderId)`. No `Driver.ready()` or `SELECT 1` was
   reached; no financial rows were accessed.
4. One exact database-only `remove-access-binding` with `--retry 0`
   returned exit 0; independent ACL read-back verified the original 2
   bindings and **0 target bindings**. Later read-only read-back
   independently confirmed original count and zero target bindings;
   no temporary IAM grant remains in current provider ACL.

**Root-cause boundary:** the denial does **not** prove database-scoped
`ydb.viewer` ineffective. The action followed closely after the grant;
Yandex IAM documents propagation delays of up to a minute. Independently,
folder-wide `Database.List` versus exact DB-scoped `Database.Get` requires
separate permission/scope validation. Neither explanation is proven by this
run. Only a **new explicit Owner IAM authorization** can permit another
grant/probe, after bounded causal redesign. Do not retry the same flow or
broaden scope merely because its one-shot result was `PERMISSION_DENIED`.

Official permission-propagation reference:
https://yandex.cloud/en/docs/iam/concepts/access-control/

`COMMITTED = NOT_PROVEN`; no Google/YDB financial write, Function invoke,
`CreateVersion`, scheduled sync or cutover was performed in this trial.

## 2026-10-10 — Database.Get пройден, обнаружен дефект YDB DSN

Owner разрешил один новый временный exact-database `ydb.viewer` для существующего
GitHub WIF SA. После подтверждённого grant выдержано >60 секунд. Один manual
probe `38044273127` на `e3c0ae7dae74132aff54d5948b7e4e5722917186`
прошёл exact `Database.Get`, но остановился на `Driver.ready()`:
`R1_DIRECT_PROBE=CONNECT_FAILED_TRANSPORT`. `SELECT 1` не выполнялся.
Временная роль сразу отозвана; независимый provider ACL read-back подтвердил
две исходные роли без назначения целевому WIF. `COMMITTED` не доказан.

Read-only проверка exact `prihrash-prod` provider metadata показала
причинную ошибку входных данных драйвера: `Database.Get.endpoint` уже содержит
полный `grpcs://…:2135?database=/location/cloud/database` DSN. Предыдущий
workflow дописывал `/location/folder/database` к **уже полному** URI, притом
использовал folder вместо cloud. Формировалась неверная строка подключения.

Исправление использует возвращённый provider endpoint без изменений и
отдельно fail-closed проверяет его exact database path
`/location/cloud/database` по метаданным GET и приватному cloud ID.
Несовпадение останавливает probe до SDK как `DB_PATH_INVALID`. Никакой
подмены authority, новых секретов, второго импортёра или финансовых запросов.

Этот code-only fix **не** разрешает повторять provider probe или выдавать IAM:
только новое явное Owner-разрешение после PR/CI и свежих provider gates.
`CreateVersion` hold инцидента 2092 остаётся отдельным.

## 2026-10-10 — root-slash DSN guard correction after #930

Одна Owner-authorized manual read-only проба `38046837347` на exact
`9c5dc71313c109ba3edbc8261ed94f87ff918d41` прошла OIDC/WIF и
`Database.Get`, но вернула `R1_DIRECT_PROBE=DB_PATH_INVALID` до SDK
`Driver.ready()` и `SELECT 1`. Временный database-scoped viewer был
отозван (CLI exit 0); независимое provider ACL read-back в этой сессии
заблокировано tool-security, поэтому его PASS не заявляется.

Причинная гипотеза подтверждена предыдущими read-only metadata shape
наблюдениями и synthetic URL parser check: provider URI имеет
`grpcs://host:2135/?database=/location/cloud/database` (root slash,
но без непустых path segments). Guard PR #930 принимал только
`url.pathname === ''` и поэтому отвергал допустимое `'/'`.
Следующая repo-only коррекция разрешает только эти два root-варианта;
non-root pathname, неверный query/path/id, TLS/port и лишние параметры
по-прежнему fail-closed. Новый provider probe/IAM grant требует отдельной
Owner-authorized boundary, `COMMITTED` не доказан.
