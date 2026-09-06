# PrihRash

Clean reboot семейной финансовой платформы.

Текущий milestone: **R0 — Data Foundation Proven**.

До отдельного cutover Google Sheets остаётся authoritative source, а production YDB writes запрещены.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

В public repository используются только synthetic fixtures. Реальные финансовые строки, amounts, descriptions, notes, raw snapshots, credentials и private identifiers запрещены.
