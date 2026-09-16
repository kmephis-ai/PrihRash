# PrihRash

Clean reboot семейной финансовой платформы.

Текущий milestone: **R1 — доказательство YDB shadow**. Первый real initial shadow bootstrap
отслеживается в [#453](https://github.com/kmephis-ai/PrihRash/issues/453);
закрытие #453 само по себе не означает прохождение полного расчётного цикла R1.

До отдельного cutover Google Sheets остаётся единственным authoritative source.
R1 shadow/migration writes в YDB разрешены только в границах migration contracts;
YDB-authoritative product/Writer writes до cutover запрещены.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run check
```

В public repository используются только synthetic fixtures. Реальные финансовые строки, amounts, descriptions, notes, raw snapshots, credentials и private identifiers запрещены.
