# R0 Change Classification — safe implementation evidence

Roadmap work unit 12 уточняет уже существующий `MIGRATION_CONTRACT` без расширения financial semantics.

## Deterministic implementation boundary

Known cleanup-compatible transitions:

```text
Карта Credit → Карта Visa
Наличка      → Карта Visa
Вика=Да      → blank
```

`WORKFLOW_TRANSFORM` разрешён только когда одновременно доказаны все пять close-context facts:

1. successful pre-close observation;
2. record входит в just-closed/pre-close working set;
3. deterministic `LEGACY_PERIOD_CLOSE` cluster detected;
4. change observed after close;
5. batch cleanup pattern confirmed.

Для cleanup-compatible transition:

- full context → `WORKFLOW_TRANSFORM` + preserve previous observed cleanup fields;
- zero close evidence → `OWNER_CORRECTION`;
- partial close evidence → `AMBIGUOUS_CHANGE`;
- cleanup + ordinary correction при наличии close evidence → `AMBIGUOUS_CHANGE`.

Ordinary non-structural corrections остаются `OWNER_CORRECTION`. Structural `EXPENSE↔INCOME` и positive→zero fail-closed как `AMBIGUOUS_CHANGE`.

## Safety

Ни одна old→new pair сама по себе не даёт sticky preservation. Tests используют только synthetic fixtures; private financial payload не требуется.
