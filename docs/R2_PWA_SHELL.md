# R2 PWA shell

## Цель

Первый пользовательский shell PrihRash намеренно минимален: быстро открыть read-only экран `Операции` поверх существующего Reader API v1 без второго financial semantics engine и без преждевременного frontend framework.

Canonical top-level navigation: `Главная / Операции / Аналитика / Ещё`. В этом этапе рабочим является только экран `Операции`; остальные пункты фиксируют информационную архитектуру, но не симулируют ещё не реализованные capabilities.

Текущее navigation state честно отражает эту границу: `Операции` — единственная интерактивная top-level destination и помечена `aria-current=page`; `Главная / Аналитика / Ещё` остаются видимыми как будущая IA, но рендерятся non-interactive elements с `aria-disabled=true` и accessible label `… — скоро`. Они не являются anchors/buttons, не меняют hash и не создают placeholder routes/screens. Synthetic UI preview получает тот же canonical shell markup.

Header также остаётся честно read-only: в R2 нет disabled `＋`/`Добавить операцию` или другого placeholder create control. Рабочая секция явно помечена `Только чтение` и оставляет только Reader-действия вроде `Обновить`; create/edit affordance появляется не раньше R3A Writer boundary, когда за ним существует реальный write contract.

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

## Basic filters

Экран `Операции` поддерживает минимальные filters из уже существующего Reader API v1:

- `type`: `EXPENSE | INCOME | TRANSFER`;
- `status`: `POSTED | VOIDED`.

UI сериализует canonical enum values вместе с fixed `limit=50`. Дополнительно account/category controls используют stable UUID из Reader filter-options v1 contract:

- `Счёт` → `accountId`;
- `Категория` → `categoryId`; category label визуально получает prefix `Расход ·` или `Доход ·`, потому что одинаковый label в разных category kind является допустимым;
- browser принимает только canonical UUID и exact known response shape; source labels, cached-operation guessing и fuzzy mapping запрещены.

Filter options загружаются отдельно через same-origin `GET /api/v1/reader/filter-options` и имеют собственный bounded local-first cache в том же IndexedDB store под единственным ключом `reader-filter-options-v1`. Cache record содержит только `schemaVersion=1`, `apiVersion=1`, `savedAt` и уже прошедший existing exact `sanitizeReaderFilterOptions()` response; operations, OAuth/session identifiers, sync status и provider identifiers туда не попадают.

Warm path сначала повторно валидирует cached filter-options response и при успехе сразу включает `Счёт/Категория` со статусом `Локальные справочники … · обновляем…`. Затем independently выполняется background network refresh. Valid fresh response атомарно заменяет единственную reference запись и UI. Network/malformed failure при valid cache не выключает controls и явно помечает их `Офлайн · справочники от …`; без valid cache сохраняется честная деградация `Счёт и категория недоступны`. Malformed/unsupported persisted record не рендерится и удаляется best-effort, а malformed network evidence не уничтожает previous valid cache.

Fresh canonical options всегда заменяют cache целиком: merge/alias/fuzzy reconciliation запрещены. Если выбранный ранее stable UUID отсутствует в fresh canonical response, соответствующий filter сбрасывается fail-closed до `Все счета`/`Все категории`, после чего Reader выполняет запрос уже без устаревшего UUID. Filter-result/history/pagination cache при этом не создаётся.

## Owner-facing freshness

Shell независимо от recent operations и filter options выполняет network-only `GET /api/v1/reader/sync-status`. Browser принимает только exact v1 shape из `R2_READER_API.md`: known `apiVersion/state`, согласованную пару `state/hasIncompleteRun` и canonical UTC timestamp для `lastCommittedAt`. Unknown keys, malformed timestamp или inconsistent state fail-closed до display.

UI показывает:

- `READY` → `Синхронизация: <дата/время>`;
- `DEGRADED` → явное `требуется проверка` + время последней успешной committed копии;
- `UNAVAILABLE` → `подтверждённой копии ещё нет`;
- network/HTTP/malformed failure → `Синхронизация: статус недоступен`.

Sync status не читается и не пишется через IndexedDB, `localStorage` или Service Worker Cache Storage. Его failure не очищает cached recent operations, не блокирует basic filters и не подменяет operation freshness status `Обновлено / Офлайн`. Service Worker, как и раньше, полностью исключает `/api/*`; новый browser validator кэшируется только как shell asset.

Filtered request является network-only browser view. Он проходит ту же fail-closed Reader response validation, но **не** читает и не пишет IndexedDB `recent-operations-v1`. Поэтому offline filtered view никогда не подменяется unfiltered cache и не выглядит как доказанный результат фильтра. При ошибке показывается отдельный safe filtered-error state.

Пустой successful result остаётся контекстным: unfiltered Reader показывает `Операций пока нет.`, а active normalized filters при valid `items=[]` показывают `По выбранным фильтрам операций нет.`. Это presentation-only distinction по existing `hasActiveReaderFilters`; loading/error/offline states не переименовываются в empty result и никакая финансовая семантика из содержимого rows не выводится.

При сбросе всех filters приложение возвращается к canonical unfiltered local-first flow: валидный recent cache может быть показан сразу, затем выполняется background refresh. Generation guard запрещает более медленному старому request перерисовать UI после новой filter selection. Canonical unfiltered refresh может безопасно обновить только свой bounded cache даже если пользователь уже переключился на filtered view; его stale render/status при этом подавляются.

## Keyset pagination

После **успешного network first-page response** UI может показать `Загрузить ещё`, только если Reader API вернул non-null `nextCursor`. Cursor остаётся opaque: browser проверяет лишь безопасную transport shape, не декодирует sort keys и не создаёт cursor самостоятельно. Next-page request сохраняет exact current `type/status/accountId/categoryId`, fixed `limit=50` и передаёт returned cursor в existing Reader API v1.

Cached/offline first page сам по себе pagination не открывает, даже если сохранённый historical response содержит `nextCursor`: это не позволяет stale cursor выглядеть как свежая continuation boundary. Дополнительные страницы всегда network-only и никогда не читаются/не пишутся в bounded IndexedDB `recent-operations-v1`. Поэтому offline storage остаётся одной canonical first page, а не превращается в history cache.

Valid additional page append-ится к уже видимым операциям только после existing fail-closed Reader response validation. Exact duplicate operation `id` относительно уже видимых items или внутри новой page считается inconsistent page: append не выполняется, предыдущие rows и cursor сохраняются для явного retry. Это exact identity guard, не fuzzy dedupe. `nextCursor=null` завершает paging.

Load-more failure не очищает уже показанный список. Concurrent second click не создаёт второй page request. Смена filters/reset увеличивает generation, поэтому старый in-flight page response не может append-иться после новой selection. Отдельный pagination status не переопределяет first-page `Обновлено / Офлайн / Фильтр` status. Между несколькими HTTP pages нет snapshot transaction; этот S-unit не обещает frozen historical snapshot во время конкурентных source changes.

## Responsive operations presentation

Экран `Операции` использует один validated presentation dataset из existing Reader v1 boundary, но показывает его по-разному в зависимости от ширины экрана: compact cards на mobile и semantic table на desktop. JavaScript не выбирает отдельный data path по viewport: `render/append` получают один и тот же массив presentation items и синхронно обновляют обе поверхности, а видимость определяет только CSS breakpoint. Поэтому filters, local-first cache, offline state и keyset pagination остаются одной state machine и не создают второй Reader/FIN-TRUTH mapping.

Desktop table имеет колонки `Дата / Операция / Тип / Контекст / Сумма / Качество`. Поле `Качество` сохраняет те же явные предупреждения `Аннулировано`, `Исторический агрегат`, unknown granularity/date precision, что и mobile cards; coarse history не становится визуально точнее из-за табличного вида. Description/context экранируются перед HTML render. Table горизонтально прокручивается внутри собственного desktop container при недостатке места и не создаёт mobile overflow. Сортировка, search, date-range, Saved Views, export и editor остаются отдельными rolling-wave items.

## Manual refresh / recovery

Экран `Операции` имеет явное действие `Обновить`, чтобы после временного offline/backend failure владелец мог восстановить Reader без полного reload PWA. Один manual refresh batch повторно использует ровно существующие boundaries: current operations view с exact текущими четырьмя filters, filter-options view и network-only sync-status. Новый API/data mapping при этом не создаётся.

Manual operations refresh является network-only retry поверх уже видимого состояния: он не перечитывает более старый IndexedDB cache поверх текущих rows и не очищает visible items перед подтверждённым network response. Для unfiltered success existing validated response атомарно заменяет bounded `recent-operations-v1`; filtered success остаётся network-only. Failure при уже видимых rows сохраняет их и явно показывает `Не удалось обновить · показаны прежние данные`, поэтому stale content не маскируется как fresh. Если rows ещё нет, manual failure показывает `Не удалось обновить операции. Можно повторить.`. Initial generic/filtered load failures направляют к уже существующему in-app действию: `Не удалось загрузить операции. Нажмите «Обновить».` и `Не удалось загрузить выбранный фильтр. Нажмите «Обновить».`; full page reload как recovery не требуется.

Refresh увеличивает existing operations generation и скрывает старую pagination boundary до нового first-page response. Поэтому in-flight `Загрузить ещё`, начатый до manual refresh, не может append-иться после него. Reference refresh аналогично не перечитывает старый cache поверх текущих controls: valid network response проходит existing exact validation и заменяет cache/UI, а failure оставляет текущие options доступными с честным recovery status.

Повторные нажатия `Обновить`, пока batch активен, coalesce в один operations/reference/sync request batch; кнопка временно disabled. Automatic polling, push и background timer этим contract не вводятся. `/api/*` остаётся вне Service Worker Cache Storage.

## Accessible Reader state

Основной динамический `data-state`, через который Reader сообщает initial loading, empty result и generic/filtered/manual-refresh error без видимых rows, является отдельным polite atomic status surface: `role="status"`, `aria-live="polite"`, `aria-atomic="true"`. Поэтому изменение уже существующего owner-facing текста объявляется assistive technology без переноса фокуса и без создания нового recovery/state path.

Эта accessibility semantics не объединяет основной result state с `sync-state`, filter-options, shadow-sync или pagination statuses и не меняет их бизнес-смысл. Тексты `Операций пока нет.`, `По выбранным фильтрам операций нет.`, `Не удалось загрузить операции. Нажмите «Обновить».`, `Не удалось загрузить выбранный фильтр. Нажмите «Обновить».` и `Не удалось обновить операции. Можно повторить.` остаются теми же existing Reader states; меняется только способ их объявления.

## Service Worker boundary

Service Worker кэширует только shell assets. `/api/*` по-прежнему исключён из Cache Storage handling: financial API persistence существует только в explicit IndexedDB Reader adapter, а не как неявный cache-first HTTP слой.

При смене shell cache version старые `prihrash-shell-*` entries удаляются при activation. Это не затрагивает IndexedDB financial cache.

## Non-scope и следующий шаг

Не входят hosting/provider deployment, history/pagination cache, filter-result matrix cache, login screen, Writer/outbox и authority change.

Следующая R2 boundary выбирается fresh discovery. OWNER-authenticated browser integration/provider deploy остаётся зависимым от canonical R1/auth provider gates; независимые UX-кандидаты выбираются только после fresh discovery.
