-- PrihRash R1 forward migration for crash-safe initial-bootstrap identity binding.
-- The manifest contains only migration identities and source observation locators/digests; no raw financial payload.

CREATE TABLE initial_bootstrap_identity_manifests (
    migration_run_id Uuid NOT NULL,
    source_snapshot_id Uuid NOT NULL,
    source_snapshot_digest String NOT NULL,
    binding_count Uint64 NOT NULL,
    bindings JsonDocument NOT NULL,
    PRIMARY KEY (migration_run_id)
) WITH (STORE = ROW);
