ALTER TABLE wars
    ADD COLUMN is_complete INTEGER NOT NULL DEFAULT 0
        CHECK (is_complete IN (0, 1));

ALTER TABLE wars
    ADD COLUMN last_observed_at INTEGER;

UPDATE wars
SET is_complete = CASE WHEN state = 'warEnded' THEN 1 ELSE 0 END,
    last_observed_at = COALESCE(created_at, CAST(strftime('%s', 'now') AS INTEGER));

CREATE INDEX IF NOT EXISTS idx_wars_regular_history
    ON wars (clan_tag, war_type, preparation_start_time DESC);

ALTER TABLE clan_raids
    ADD COLUMN is_complete INTEGER NOT NULL DEFAULT 0
        CHECK (is_complete IN (0, 1));

ALTER TABLE clan_raids
    ADD COLUMN last_observed_at INTEGER;

UPDATE clan_raids
SET is_complete = CASE WHEN state = 'ended' THEN 1 ELSE 0 END,
    last_observed_at = COALESCE(created_at, CAST(strftime('%s', 'now') AS INTEGER));

CREATE INDEX IF NOT EXISTS idx_clan_raids_history
    ON clan_raids (clan_tag, start_time DESC);
