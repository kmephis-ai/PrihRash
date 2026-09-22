-- R1 recovery/read-path optimization: exact synchronous index for run-scoped revision evidence.
ALTER TABLE source_record_revisions
ADD INDEX idx_source_record_revisions_run_revision GLOBAL SYNC
ON (migration_run_id, revision)
COVER (observed_at, row_hint, row_digest, change_class);
