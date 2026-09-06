-- PrihRash R1.1 initial YDB row-store schema.
-- Version application/checksum bookkeeping is performed by the migration runner.
-- Repeated or unexpected apply must fail closed; schema drift must never be hidden.

CREATE TABLE transactions (
    id Uuid NOT NULL,
    type Utf8,
    occurred_on Date,
    captured_at Timestamp,
    record_granularity Utf8,
    date_precision Utf8,
    aggregate_period_month Date,
    financial_period_id Uuid,
    period_assignment_quality Utf8,
    amount_minor Int64,
    currency Utf8,
    from_account_id Uuid,
    to_account_id Uuid,
    category_id Uuid,
    paid_by_member_id Uuid,
    description Utf8,
    note Utf8,
    status Utf8,
    analytics_state Utf8,
    flow_kind Utf8,
    created_at Timestamp,
    updated_at Timestamp,
    version Uint64,
    PRIMARY KEY (id)
) WITH (STORE = ROW);

CREATE TABLE accounts (
    id Uuid NOT NULL,
    name Utf8,
    kind Utf8,
    balance_nature Utf8,
    currency Utf8,
    status Utf8,
    PRIMARY KEY (id)
) WITH (STORE = ROW);

CREATE TABLE categories (
    id Uuid NOT NULL,
    name Utf8,
    kind Utf8,
    parent_id Uuid,
    status Utf8,
    sort_order Int32,
    PRIMARY KEY (id)
) WITH (STORE = ROW);

CREATE TABLE family_members (
    id Uuid NOT NULL,
    name Utf8,
    status Utf8,
    PRIMARY KEY (id)
) WITH (STORE = ROW);

CREATE TABLE finance_profiles (
    id Uuid NOT NULL,
    timezone Utf8,
    target_close_day Uint32,
    version Uint64,
    PRIMARY KEY (id)
) WITH (STORE = ROW);

CREATE TABLE source_records (
    id Uuid NOT NULL,
    source_type Utf8,
    source_sheet Utf8,
    first_seen_at Timestamp,
    last_seen_at Timestamp,
    last_row_hint Uint64,
    current_digest String,
    state Utf8,
    classification Utf8,
    normalization_status Utf8,
    transaction_id Uuid,
    current_revision Uint64,
    resolution_code Utf8,
    resolved_at Timestamp,
    resolved_by Utf8,
    PRIMARY KEY (id)
) WITH (STORE = ROW);

CREATE TABLE source_record_revisions (
    source_record_id Uuid NOT NULL,
    revision Uint64 NOT NULL,
    migration_run_id Uuid,
    observed_at Timestamp,
    row_hint Uint64,
    row_digest String,
    change_class Utf8,
    raw_payload JsonDocument,
    PRIMARY KEY (source_record_id, revision)
) WITH (STORE = ROW);

CREATE TABLE source_snapshots (
    id Uuid NOT NULL,
    captured_at Timestamp,
    source_sheet Utf8,
    snapshot_digest String,
    row_count Uint64,
    PRIMARY KEY (id)
) WITH (STORE = ROW);

CREATE TABLE migration_runs (
    id Uuid NOT NULL,
    started_at Timestamp,
    finished_at Timestamp,
    source_snapshot_digest String,
    state Utf8,
    rows_seen Uint64,
    rows_new Uint64,
    rows_changed Uint64,
    rows_missing Uint64,
    rows_ambiguous Uint64,
    error_code Utf8,
    PRIMARY KEY (id)
) WITH (STORE = ROW);

CREATE TABLE schema_migrations (
    version Uint64 NOT NULL,
    checksum String,
    applied_at Timestamp,
    PRIMARY KEY (version)
) WITH (STORE = ROW);

-- Stable singleton FinanceProfile identity is public configuration metadata, not a private identifier.
UPSERT INTO finance_profiles (id, timezone, target_close_day, version)
VALUES (
    Uuid("00000000-0000-0000-0000-000000000001"),
    "Europe/Moscow"u,
    Uint32("14"),
    Uint64("1")
);
