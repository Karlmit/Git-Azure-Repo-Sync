ALTER TABLE connections ADD COLUMN poll_interval_minutes INTEGER NOT NULL DEFAULT 2;

UPDATE connections
SET poll_interval_minutes = MAX(1, CAST(ROUND(poll_interval_seconds / 60.0) AS INTEGER));

ALTER TABLE connections DROP COLUMN poll_interval_seconds;
