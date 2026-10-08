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
