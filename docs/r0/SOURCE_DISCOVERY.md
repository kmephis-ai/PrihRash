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

## Legacy close marker physical predicate — PROVEN

Private full-source probe подтвердил deterministic cluster rule без fuzzy matching и без зависимости от category:

- exact zero-row shape: `Расход` + `Карта Visa` + amount `0` + known source day;
- exact observed marker vocabulary перечислен в `SOURCE_ADAPTER_CONTRACT`;
- candidates должны принадлежать одному source day и tight snapshot sequence (gap между соседними marker candidates ≤ 2);
- required marker kinds: `BALANCE + NEGATIVE + VIKA + (POSITIVE | CREDIT)`;
- `LOAN` optional; duplicate marker kind допустим;
- description alone никогда не даёт `LEGACY_PERIOD_CLOSE`;
- unrelated zero row не повышается вместе с cluster;
- partial/isolated known markers fail-closed → `AMBIGUOUS`.

На full private source rule детерминированно выделил **21** close cluster; **2** isolated known markers остались `AMBIGUOUS`. Реальные dates/rows/amounts/notes и boundary details в public evidence не публикуются. Synthetic tests воспроизводят complete, historical partial, duplicate/variant, unrelated-row и malformed cases.
