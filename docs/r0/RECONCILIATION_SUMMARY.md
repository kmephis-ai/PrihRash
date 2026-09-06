# R0 Reconciliation Summary — safe public evidence

Дата read-only проверки: **2026-09-06**.

Этот документ содержит только безопасные агрегированные статусы и structural evidence. Реальные amounts, descriptions, notes, source rows, private snapshots/digests и spreadsheet identifiers здесь запрещены.

## Full-source classification

Authoritative `Ответы на форму (11)` проверен целиком по A–K stable adapter schema.

Safe classification summary:

| Metric | Result |
|---|---:|
| Meaningful source rows | 17 790 |
| Explicitly classified rows | 17 790 |
| Silent drop | **0** |
| `FINANCIAL_RECORD` | 17 627 |
| `LEGACY_PERIOD_CLOSE` | 121 |
| `AMBIGUOUS` | 41 |
| `NON_FINANCIAL` | 1 |
| `INVALID` | 0 |

`AMBIGUOUS` не был принудительно обнулён: zero/service и structurally incomplete rows остаются fail-closed, если Transaction semantics не доказана.

## Positive financial normalization

- positive EXPENSE/INCOME candidates: **17 627**;
- normalization failures: **0**;
- explicit `Не учитывать` facts: **2**, сохранены как Transactions с `analytics_state=EXCLUDED`;
- unknown operation/account/Vika vocabulary среди deterministically normalizable positive rows не обнаружен.

## Independent raw baseline

Baseline считался отдельным private read-only path напрямую из physical A–K source. Canonical path отдельно прогонял те же positive financial candidates через фактические TypeScript EXPENSE/INCOME normalizers и reference resolvers.

Сравнение выполнялось только для `INCLUDED` comparable records и в exact minor units по ключу:

```text
(type, category, calendar_month, account)
```

Результат:

| Check | Result |
|---|---:|
| Comparable aggregate groups | 2 328 |
| Missing canonical groups | **0** |
| Extra canonical groups | **0** |
| Value mismatches | **0** |

Таким образом, independent raw baseline и canonical projection совпали точно; tolerance/rounding allowance не использовался.

## Historical granularity

Private read-only evidence подтверждает отдельный contiguous coarse EXPENSE bootstrap epoch и последующий item-level epoch. Exact real boundary остаётся private evidence.

Public classifier остаётся parameterized initial-snapshot rule: он не выводит granularity из даты, суммы, `00:00`, совпадения description/category или других слабых признаков по отдельности. Unanchored/new records не наследуют historical cutoff.

## Reference-only cross-check

Reference sheets использовались только как oracle привычного legacy поведения, не как source Transactions.

Representative windows:

| Window | Expense category rows | Income category rows | Result |
|---|---:|---:|---|
| proven coarse month | 24/24 exact | 6/6 exact | PASS |
| first item-level transition month | 18/24 raw full-month exact | 6/6 exact | PASS WITH EXPLAINED LEGACY SEMANTICS |
| modern complete month | 24/24 exact | 6/6 exact | PASS |

### Почему transition expense имеет 6 reference mismatches

Legacy `Расход` formulas в этом transition month используют `QUERY` по `ФормаНовая` с верхней границей вида:

```text
A <= date '<calendar month last day>'
```

В transition epoch source уже содержит timestamped rows. Такая legacy formula исключает операции последнего календарного дня после `00:00`. Все шесть расхождений полностью объясняются именно этим boundary behavior: при сравнении с тем же effective legacy interval reference category rows совпадают 24/24.

В modern reference formulas upper boundary уже сдвинута на следующий calendar day, и category-level comparison снова совпадает 24/24.

### Почему legacy total row не является canonical total oracle

Expense `ИТОГО РАСХОД` structurally суммирует только фиксированный ранний поддиапазон category rows (`SUM(...2:17)`), хотя ниже присутствуют дополнительные категории. Поэтому этот legacy total не эквивалентен `SUM(all canonical EXPENSE categories)` и не используется для доказательства canonical total.

Income total использует собственный fixed category range. Cross-check выполняется на category rows, где семантика формул наблюдаема напрямую.

## R0 reconciliation verdict

```text
source classification: PASS
silent drop: 0
positive normalizer coverage: PASS
independent exact baseline: PASS
historical granularity honesty: PASS
reference cross-check: PASS WITH EXPLAINED LEGACY ORACLE SEMANTICS
private payload in public evidence: NONE
```

Unresolved historical ambiguity остаётся явной `AMBIGUOUS`; она не является unexplained mismatch и не переписывается ради красивого PASS.
