# R1 Scheduled Sync Runtime

## Admission boundary

До любых incremental writes scheduled invocation обязан сначала прочитать свежий полный authoritative Google snapshot и provider evidence о MigrationRun history, затем вызвать pure admission policy.

Вход admission:

- digest свежего полного source snapshot;
- последний доказанный `COMMITTED` MigrationRun либо `null`;
- все незавершённые `STAGING` / `VALIDATED` MigrationRun.

Решения:

- `RECOVERY_REQUIRED` — существует хотя бы один незавершённый run; новый sync запрещён;
- `BOOTSTRAP_REQUIRED` — нет доказанного COMMITTED baseline; scheduled runtime не запускает bootstrap автоматически;
- `NO_CHANGE` — свежий digest точно равен digest последнего COMMITTED baseline; новый MigrationRun не создаётся;
- `START_INCREMENTAL` — clean COMMITTED baseline существует и fresh digest изменился.

## Fail-closed rules

- `FAILED` MigrationRun никогда не является baseline;
- malformed baseline/incomplete evidence не игнорируется и не нормализуется, а блокирует admission;
- пустой либо неканонический digest блокирует admission;
- незавершённый run имеет приоритет над `NO_CHANGE`, `START_INCREMENTAL` и `BOOTSTRAP_REQUIRED`;
- admission не пишет в YDB, не меняет Google и не выполняет recovery автоматически;
- private financial payload не входит в admission result и не должен попадать в logs/evidence.

## Single-observation handoff

`START_INCREMENTAL` относится к конкретному fresh authoritative observation. Runtime не имеет права после admission повторно читать source и молча обрабатывать уже другой snapshot.

Поэтому application-layer invocation:

1. читает full source observation ровно один раз;
2. выполняет admission по digest именно этого observation;
3. при `START_INCREMENTAL` передаёт incremental runner тот же immutable observation/opaque snapshot handle;
4. при остальных решениях incremental runner не вызывается;
5. наружу возвращает только safe decision/digest status, без snapshot payload.

Это устраняет TOCTOU между admission и incremental processing, не превращая raw financial payload в operational evidence.

## Следующая runtime boundary

Следующий S-unit должен добавить concrete Google Sheets read adapter для immutable full-snapshot observation и связать его с существующим incremental pipeline. Таймер/cron не должен содержать financial semantics: scheduler только инициирует одну runtime invocation, а policy остаётся в application layer.
