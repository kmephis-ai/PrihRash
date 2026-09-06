from pathlib import Path

path = Path('docs/MIGRATION_CONTRACT.md')
text = path.read_text(encoding='utf-8')
start_marker = '### Raw payload schema v1\n'
end_marker = '\n\n## 6. Raw digest\n'
if text.count(start_marker) != 1 or text.count(end_marker) != 1:
    raise SystemExit('unexpected normative anchors')
start = text.index(start_marker)
end = text.index(end_marker, start)
replacement = '''### Raw payload schema v2

`raw_payload` — приватный diagnostic/provenance payload с **всеми 11 source fields** через stable adapter keys и с сохранением физического cell kind. Schema v1 (`string | null`) заменена **до первого production shadow bootstrap**, потому что она стирала различие между numeric cell и numeric-looking source string.

Synthetic example:

```json
{
  "adapter_schema_version": 2,
  "date": {"kind":"NUMBER","value":"45292.5"},
  "operation_type": {"kind":"STRING","value":"Расход"},
  "expense_account": {"kind":"STRING","value":"Synthetic Account"},
  "expense_category": {"kind":"STRING","value":"Synthetic Category"},
  "description": {"kind":"STRING","value":"Synthetic Description"},
  "expense_amount": {"kind":"NUMBER","value":"123.45"},
  "income_account": null,
  "income_category": null,
  "income_amount": null,
  "vika_flag": null,
  "note": null
}
```

Правила:

- `row_hint` хранится отдельно и не дублируется как identity;
- blank → `null`;
- source text → `{kind:"STRING", value:<text>}` после только технически безопасной NFC/line-ending normalization;
- Google `numberValue` → `{kind:"NUMBER", value:<canonical plain decimal>}` без locale parsing и без arithmetic rounding;
- numeric-looking `STRING` **никогда** не повышается до `NUMBER`;
- formula/bool/error в authoritative A–K → fail-closed source review; formula не вычисляется importer-ом как финансовое значение;
- source date/datetime сохраняется как typed Google Sheets serial number, включая fractional time component;
- изменение physical source schema **или** provenance encoding требует нового `adapter_schema_version`, а не тихого переиспользования старого payload contract;
- payload никогда не публикуется в GitHub/log evidence.

#### Decoder contract v2

- financial operation определяется только exact `Расход` / `Доход` из typed `STRING`;
- active amount — только `expense_amount` для `Расход` и `income_amount` для `Доход`; inactive amount column не интерпретируется как financial value;
- active amount обязан быть typed `NUMBER`; `STRING`, formula-like/unsupported cell или non-canonical decimal → fail-closed;
- RUB minor units вычисляются integer parsing-ом canonical decimal: максимум 2 fractional digits, без rounding; unsafe integer range → fail-closed;
- Google Sheets serial date использует epoch `1899-12-30`; whole serial day задаёт `occurred_on`, fractional part остаётся raw provenance и не превращается в отдельный guessed timestamp;
- text fields decoder принимает только typed `STRING | null`; numeric/text coercion запрещён;
- existing negative/zero financial semantics по-прежнему решает classifier/normalizer, decoder их не переопределяет.
'''
text = text[:start] + replacement + text[end:]
old_digest = 'Нормализация допускает только стабильное представление пустых значений, чисел, дат, line endings и Unicode.'
new_digest = 'Нормализация включает cell kind и canonical value: `NUMBER 123` и `STRING "123"` обязаны иметь разные digest inputs. Допускаются только стабильное представление blank, typed numbers, typed strings, dates, line endings и Unicode.'
if text.count(old_digest) != 1:
    raise SystemExit('unexpected raw digest contract')
text = text.replace(old_digest, new_digest, 1)
path.write_text(text, encoding='utf-8')
