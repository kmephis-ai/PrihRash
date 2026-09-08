# R2 PWA shell

## Цель

Первый пользовательский shell PrihRash намеренно минимален: быстро открыть read-only экран `Операции` поверх существующего Reader API v1 без второго financial semantics engine и без преждевременного frontend framework.

Canonical top-level navigation: `Главная / Операции / Аналитика / Ещё`. В этом этапе рабочим является только экран `Операции`; остальные пункты фиксируют информационную архитектуру, но не симулируют ещё не реализованные capabilities.

## Reader boundary

Shell делает same-origin `GET /api/v1/operations/recent?limit=50` и ожидает exact response `apiVersion=1` из `R2_READER_API.md`. Amount приходит только как integer minor units и форматируется в RUB исключительно presentation layer.

Browser boundary fail-closed валидирует transport shape и перед persistence строит whitelisted Reader v1 envelope только из известных полей. Unknown HTTP keys не сохраняются в IndexedDB и не становятся скрытым browser storage channel. Это transport/presentation validation, а не второй financial semantics engine: финансовый смысл по-прежнему задаёт canonical backend Reader поверх Transactions.

UI обязан явно показывать качество факта:

- `VOIDED` → `Аннулировано`;
- `PERIOD_AGGREGATE` → `Исторический агрегат`;
- `recordGranularity=UNKNOWN` → `Неизвестная детализация`;
- `datePrecision=MONTH|UNKNOWN` не отображается как доказанная точная daily purchase.

## Local-first recent operations

IndexedDB хранит ровно одну bounded запись `recent-operations-v1`:

- `schemaVersion=1`;
- `apiVersion=1`;
- `savedAt`;
- последний валидированный и whitelisted Reader response для current recent page.

При открытии `Операций` приложение сначала пытается прочитать эту запись. Валидный cache рендерится сразу, не ожидая network round-trip, и явно помечается `Локальные данные … · обновляем…`. Затем independently выполняется background refresh.

Successful network response сначала проходит ту же browser Reader validation. После этого IndexedDB `put` атомарно заменяет единственную cached запись, UI получает fresh result и status `Обновлено`. Если локальное persistence недоступно, fresh network data можно показать, но UI честно сообщает `локальное сохранение недоступно`.

Network/HTTP/malformed-response failure:

- при наличии valid cache не очищает и не маскирует его как свежий: остаются локальные данные со статусом `Офлайн · локальные данные от …`;
- без valid cache показывает generic safe error;
- malformed/unsupported cache никогда не рендерится и удаляется best-effort до network path.

Cache не хранит OAuth/session identifiers. OWNER session остаётся HttpOnly cookie boundary из `R2_OWNER_AUTH.md`.

## Service Worker boundary

Service Worker кэширует только shell assets. `/api/*` по-прежнему исключён из Cache Storage handling: financial API persistence существует только в explicit IndexedDB Reader adapter, а не как неявный cache-first HTTP слой.

При смене shell cache version старые `prihrash-shell-*` entries удаляются при activation. Это не затрагивает IndexedDB financial cache.

## Non-scope и следующий шаг

Не входят hosting/provider deployment, history/pagination cache, filter matrix cache, login screen, Writer/outbox и authority change.

Следующая R2 boundary выбирается fresh discovery. Наиболее полезные кандидаты после local-first read: OWNER-authenticated browser integration/provider deploy либо минимальные Reader filters/date-range UX — без расширения к production writes до соответствующих gates.
