# R2 Reader API — минимальный contract

## Назначение

Первый Reader API contract намеренно узкий: дать UI стабильный read-only список последних операций без преждевременного universal API или framework coupling.

Application boundary не является HTTP server. Будущий Yandex/provider handler обязан только:

1. доказать `OWNER` auth;
2. преобразовать transport query parameters в `ReaderApiQuery`;
3. вызвать `executeReaderRecentOperationsApiRequest()`;
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
- account/category/member представлены stable id + canonical display label;
- malformed/orphaned provider evidence fail-closed через существующий Reader/`validateTransaction()` path.

## Paging

Paging keyset-based, без `OFFSET`, по exact order:

```text
occurred_on DESC, captured_at DESC, id DESC
```

Cursor opaque для клиента и содержит только эти три sort keys. Он не содержит amount, description, note или provider identifiers.

## Не является частью v1

- date-range query;
- free-text search;
- analytics/dashboard API;
- writes;
- MEMBER permissions;
- universal CRUD schema;
- Yandex auth/provider transport details.

Contract расширяется только по доказанной Reader UX необходимости.
