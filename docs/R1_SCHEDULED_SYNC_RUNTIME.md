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

## Следующая runtime boundary

Следующий S-unit должен получить эти три вида evidence через concrete read adapters и только при `START_INCREMENTAL` передать управление уже существующему incremental pipeline. Таймер/cron не должен содержать financial semantics: scheduler только инициирует одну runtime invocation, а policy остаётся в application layer.
