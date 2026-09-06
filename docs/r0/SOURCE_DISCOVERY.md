# R0 Source Discovery — safe public evidence

Дата read-only проверки: **2026-09-06**.

Этот файл содержит только безопасные структурные выводы. Raw Google rows, реальные amounts, descriptions, notes, source snapshots, spreadsheet ID и private digests здесь запрещены.

## Проверено

- authoritative spreadsheet identity соответствует `ПрихРасхOnline`;
- transactional tab: `Ответы на форму (11)`;
- A–K header совпадает с `SOURCE_ADAPTER_CONTRACT`, включая ведущий пробел в ` Дата`;
- spreadsheet timezone: `Europe/Moscow`;
- live `operation_type` vocabulary для непустых значений: только `Расход` / `Доход`;
- live expense-account vocabulary: только `Карта Visa`, `Карта Credit`, `Наличка`;
- live income-account vocabulary: только `Карта Visa`, `Наличка`, `Карта Credit`, `Приход`;
- live expense `Вика` vocabulary: blank / `Да`;
- неожиданные account aliases не обнаружены.

## Historical granularity

Private read-only probe доказал отдельный contiguous bootstrap block ранних EXPENSE records с coarse monthly/category semantics и последующий item-level expense epoch. Exact real boundary остаётся private evidence и не коммитится в public repository.

Public implementation использует parameterized initial-snapshot evidence, а не magic date/content heuristic. Новые/unanchored records не наследуют historical cutoff и остаются `UNKNOWN` до доказательства.

## Open blocker: legacy close marker physical predicate

Live source подтверждает zero/service rows с close-like description vocabulary, но literal `Итоги по месяцу` не является надёжным exact physical predicate; также наблюдаются безопасные spelling variants conceptual marker labels. Поэтому `LEGACY_PERIOD_CLOSE` classifier пока не должен угадывать close event только по description.

Нужно доказать deterministic cluster/context predicate и перенести его в synthetic tests. До этого соответствующий work unit fail-closed; ordinary positive EXPENSE/INCOME normalizers этим не блокируются.
