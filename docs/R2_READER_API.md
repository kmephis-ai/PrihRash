# R2 Reader API — минимальный contract

## Назначение

Первый Reader API contract намеренно узкий: дать UI стабильный read-only список последних операций без преждевременного universal API или framework coupling.

Application boundary не является HTTP server. Будущий Yandex/provider handler обязан только:

1. доказать `OWNER` auth;
2. для recent operations преобразовать transport query parameters в `ReaderApiQuery`;
3. вызвать соответствующий application handler: `executeReaderRecentOperationsApiRequest()` или `executeReaderFilterOptionsApiRequest()`;
4. сериализовать versioned response;
5. безопасно отобразить transport/provider errors без private payload.

Auth, CORS, hosting и deployment не входят в этот contract.

## Admission boundary

API не создаёт собственный read path и не обходит R1 admission semantics. `executeReaderRecentOperationsApiRequest()` делегирует existing `readRecentOperationsPage()`, поэтому canonical Transactions читаются только при наличии durable verified shadow baseline.

Если verified shadow недоступен, существующий Reader возвращает safe `VERIFIED_SHADOW_UNAVAILABLE` до canonical transactions read. Transport layer не должен заменять этот код догадкой, fallback-данными или чтением другого analytics source.

## Request v1

Разрешены только optional query parameters:

- `limit` — canonical decimal integer `1..100`, default `50`;
- `type` — `EXPENSE | INCOME | TRANSFER`;
- `status` — `POSTED | VOIDED`;
- `accountId` — canonical UUID; фильтр применяется и к source, и к destination account;
- `categoryId` — canonical UUID;
- `cursor` — opaque cursor, возвращённый предыдущей page response.

Unknown parameter, массив/duplicate-like значение, blank value, malformed UUID/cursor или noncanonical limit блокируются до любого provider read. Raw query value не входит в request error message.

## Response v1

```text
{
  apiVersion: 1,
  items: ReaderOperation[],
  pageSize: number,
  nextCursor: string | null
}
```

`ReaderOperation` сохраняет canonical FIN-TRUTH без backend display rounding:

- amount — integer minor units + `RUB`;
- `VOIDED` возвращается явным status, а не скрывается;
- `recordGranularity`, `datePrecision`, `aggregatePeriodMonth`, `periodAssignmentQuality` обязательны для честного отображения coarse/legacy history;
- `capturedAt` — доказанное capture time или `null`; legacy `null` не повышается до guessed timestamp;
- account/category/member представлены stable id + canonical display label;
- malformed/orphaned provider evidence fail-closed через существующий Reader/`validateTransaction()` path.

## Filter options v1

Чтобы browser мог безопасно выбрать уже поддерживаемые `accountId/categoryId`, Reader application layer предоставляет отдельный read-only contract `executeReaderFilterOptionsApiRequest()` без query parameters:

```text
{
  apiVersion: 1,
  accounts: [{ id, label }],
  categories: [{ id, label, kind }]
}
```

Этот path использует ту же verified-shadow admission boundary до чтения canonical references. Он не читает reference-only Google sheets и не создаёт alias/mapping engine.

Правила evidence:

- account: canonical UUID + nonblank canonical `name` + exact `currency=RUB`;
- category: canonical UUID + nonblank canonical `name` + `kind=EXPENSE|INCOME`;
- `status` намеренно не используется как visibility predicate: historical/inactive reference может оставаться нужным для фильтрации существующей истории;
- exact duplicate account display label считается ambiguous human choice и fail-closed;
- exact duplicate category `(kind,label)` также fail-closed; category одинакового label в разных kind допустима и UI обязан различать kind;
- никакого fuzzy merge/dedupe/normalized alias; malformed/non-RUB/unknown-kind evidence не попадает в response;
- deterministic order: accounts `label,id`, categories `kind,label,id`.

Provider/transport wiring этого contract остаётся отдельным item после разрешённых auth/provider gates.

## Sync status v1

Для owner-facing freshness Reader application layer предоставляет `executeReaderSyncStatusApiRequest()` без HTTP/server wiring. Единственный источник — existing `readScheduledSyncAdmissionEvidence()`; отдельный migration/scheduler truth не создаётся.

Response содержит только privacy-safe состояние:

```text
{
  apiVersion: 1,
  state: READY | DEGRADED | UNAVAILABLE,
  lastCommittedAt: string | null,
  hasIncompleteRun: boolean
}
```

Deterministic rules:

- `READY` — существует verified `COMMITTED` baseline и нет `STAGING|VALIDATED`;
- `DEGRADED` — verified `COMMITTED` baseline существует, но есть хотя бы один incomplete run;
- `UNAVAILABLE` — доказанного `COMMITTED` baseline нет, независимо от наличия incomplete run;
- `lastCommittedAt` берётся только из `finishedAt` latest committed baseline и равен `null` для `UNAVAILABLE`;
- `hasIncompleteRun` — только boolean, без количества/identity incomplete runs.

Response/error никогда не включает source snapshot digest, MigrationRun id/counters, provider identifiers, financial aggregates или raw evidence. Storage failure, malformed/duplicate MigrationRun evidence fail-closed как value-free `SYNC_STATUS_EVIDENCE_UNAVAILABLE`.

HTTP route/provider wiring остаётся отдельным provider-capable item; этот contract сам по себе не меняет R1 runtime и не разрешает shadow writes.

## Paging

Paging keyset-based, без `OFFSET`, по exact order:

```text
occurred_on DESC,
CASE WHEN captured_at IS NULL THEN 1 ELSE 0 END ASC,
captured_at DESC,
id DESC
```

Cursor opaque для клиента и содержит только эти три logical sort keys; `captured_at` внутри cursor может быть `null`. Non-null capture timestamps идут перед `null`, а keyset predicate имеет отдельные ветки для timestamp/null и никогда не сравнивает `NULL` с guessed timestamp. Cursor не содержит amount, description, note или provider identifiers.

## Не является частью v1

- date-range query;
- free-text search;
- analytics/dashboard API;
- writes;
- MEMBER permissions;
- universal CRUD schema;
- Yandex auth/provider transport details.

Contract расширяется только по доказанной Reader UX необходимости.
