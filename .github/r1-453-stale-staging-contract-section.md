#### Stale initial `STAGING` retirement after authoritative snapshot drift

Если durable initial claim внутренне согласован (run ↔ identity manifest ↔ source snapshot), но fresh authoritative Google observation имеет **другой** `source_snapshot_digest`, такой run нельзя resume/replay: identity decisions принадлежат другому immutable source observation.

Разрешён только bounded terminalization path со всеми условиями одновременно:

1. durable admission доказывает отсутствие `COMMITTED` baseline и ровно один incomplete run в `STAGING`;
2. read-only staging diagnostic доказывает именно `AUTHORITATIVE_SNAPSHOT_DIGEST_MISMATCH`; malformed/duplicate/contradictory manifest/snapshot/revision evidence не подходит;
3. canonical verified-current `source_records` и `transactions` independently доказаны exact empty;
4. transition меняет только exact matched `migration_runs` row `STAGING → FAILED` с фиксированным `error_code=INITIAL_BOOTSTRAP_STALE_AUTHORITATIVE_SNAPSHOT`, optimistic predicates сохраняют immutable run fields, а transactional read-back exact-сверяет terminal row;
5. `source_snapshots`, `initial_bootstrap_identity_manifests` и уже materialized append-only `source_record_revisions` **не удаляются, не переписываются и не переиспользуются**; это audit/recovery evidence failed attempt;
6. fresh bootstrap после terminalization обязан создать новый run/snapshot/manifest и explicit новые row identity allocations из текущего authoritative observation; identities failed attempt не являются candidate pool;
7. до появления нового exact `COMMITTED` baseline Reader по-прежнему не видит verified shadow; сам `FAILED` marker не является success/cutover evidence.

Если current state не empty, durable metadata не согласована, digest mismatch не доказан или lifecycle write/read-back неоднозначен, terminalization не выполняется и boundary остаётся `RECOVERY_REQUIRED`.

