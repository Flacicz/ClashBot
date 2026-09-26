ALTER TABLE clans
    ADD COLUMN tracking_enabled INTEGER NOT NULL DEFAULT 1
        CHECK (tracking_enabled IN (0, 1));
