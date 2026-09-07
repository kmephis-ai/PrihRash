-- PrihRash R1.9 forward migration for durable exact legacy reference bootstrap keys.
-- Display names remain independently renameable; no source vocabulary data is seeded here.

ALTER TABLE accounts ADD COLUMN normalized_source_label Utf8;
ALTER TABLE categories ADD COLUMN normalized_source_label Utf8;
