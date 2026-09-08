-- PrihRash R2 OWNER auth persistence bootstrap.
-- This schema is intentionally separate from financial db/migrations/schema_migrations.
-- It must not be applied to provider YDB before the canonical R1 readiness gate permits provider mutation.

CREATE TABLE owner_oauth_transactions (
    state_hash Utf8 NOT NULL,
    code_verifier Utf8 NOT NULL,
    created_at_ms Uint64 NOT NULL,
    PRIMARY KEY (state_hash)
) WITH (STORE = ROW);

CREATE TABLE owner_sessions (
    session_hash Utf8 NOT NULL,
    role Utf8 NOT NULL,
    issued_at_ms Uint64 NOT NULL,
    expires_at_ms Uint64 NOT NULL,
    PRIMARY KEY (session_hash)
) WITH (STORE = ROW);
