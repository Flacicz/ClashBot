CREATE TABLE sync_outages
(
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    clan_tag       TEXT    NOT NULL,
    service_name   TEXT    NOT NULL,
    failure_count  INTEGER NOT NULL DEFAULT 1 CHECK (failure_count >= 1),
    started_at     INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    recovered_at   INTEGER,
    FOREIGN KEY (clan_tag) REFERENCES clans (tag) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_sync_outages_open
    ON sync_outages (clan_tag, service_name)
    WHERE recovered_at IS NULL;

CREATE INDEX idx_sync_outages_history
    ON sync_outages (clan_tag, service_name, started_at DESC);

