# R1 Closure Path — внешний read-only probe

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

Добавлен manual-only workflow `.github/workflows/r1-direct-ydb-readonly.yml`.
Он использует уже существующую GitHub OIDC → Yandex WIF identity,
запрашивает только metadata существующей базы `prihrash-prod` через
`Database.List` и выполняет `SELECT 1`. Если текущему WIF недостаточно
прав для Database.List/SELECT, workflow завершится `PERMISSION_DENIED`;
никакого автоматического добавления IAM роли нет.

После merge запускать вручную только при отсутствии другого active R1 writer.
Этот маршрут не имеет provider write или финансового write authority.

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

**Decision point — `BLOCKED_NEEDS_EXPLICIT_DATABASE_READ_AUTHORITY`:** один scoped,
временный grant `ydb.viewer` на конкретную `prihrash-prod` существующей
`prihrash-github-initial-bootstrap` может разрешить `Database.List` и `SELECT 1`,
но это **реальная возможность читать финансовые строки** через data-plane. Поэтому
grant **не** входит в заранее разрешённый `CreateVersion`, не выдан Owner и не
может быть добавлен даже «ради диагностики» без отдельного informed Owner decision.
Пока decision нет, не запускать тот же failed probe заново, не создавать и не
имперсонировать новый principal, не использовать Owner IAM token и не переносить
connection string в GitHub event input/log/issue.

Если Owner разрешит временный database-scoped `ydb.viewer`, следующий отдельный
Incident-M обязан доказать до IAM mutation: exact current `main`, canonical CI PASS,
active #630, отсутствие writer conflict, exact SA/DB IDs приватно, текущую ACL и
отсутствие duplicate grant. Использовать только **добавление одной exact binding**
(`add-access-binding`), не folder/cloud-wide role и не
`set-access-bindings`, которая заменяет весь ACL. Предусмотреть проверяемое
read-back и обратное удаление **только собственной** binding после пробы;
неизвестный outcome = read-only recovery, не blind delete/regrant. Сам read-only
probe остаётся manual/exact-main/one-shot, не запускает financial import и не
публикует SQL-result rows. Сразу после диагностического evidence — retirement
временного grant, подтверждённый повторным ACL read-back.

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
