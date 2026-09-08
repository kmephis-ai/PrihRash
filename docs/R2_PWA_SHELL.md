# R2 PWA shell

## Цель

Первый пользовательский shell PrihRash намеренно минимален: быстро открыть read-only экран `Операции` поверх существующего Reader API v1 без второго financial semantics engine и без преждевременного frontend framework.

Canonical top-level navigation: `Главная / Операции / Аналитика / Ещё`. В этом S-unit рабочим является только экран `Операции`; остальные пункты фиксируют информационную архитектуру, но не симулируют ещё не реализованные capabilities.

## Reader boundary

Shell делает same-origin `GET /api/v1/operations/recent?limit=50` и ожидает exact response `apiVersion=1` из `R2_READER_API.md`. Amount приходит только как integer minor units и форматируется в RUB исключительно presentation layer.

UI обязан явно показывать качество факта:

- `VOIDED` → `Аннулировано`;
- `PERIOD_AGGREGATE` → `Исторический агрегат`;
- `recordGranularity=UNKNOWN` → `Неизвестная детализация`;
- `datePrecision=MONTH|UNKNOWN` не отображается как доказанная точная daily purchase.

Malformed API response или HTTP failure не подменяются cached/fallback financial data: shell показывает generic safe error.

## PWA/offline boundary

Service Worker кэширует только shell assets. `/api/*` исключён из cache handling. Этот S-unit не сохраняет financial response в Cache Storage, IndexedDB или localStorage и не создаёт offline financial truth.

OAuth/session identifiers также не сохраняются browser storage. Canonical OWNER session transport остаётся HttpOnly cookie boundary из `R2_OWNER_AUTH.md`.

## Non-scope и следующий шаг

Не входят hosting/provider deployment, IndexedDB recent-data cache, background refresh, login screen и Writer. Следующий независимый Reader UX S-unit после проверки shell — IndexedDB cache recent operations с network refresh вне critical path и честным offline/staleness state.
