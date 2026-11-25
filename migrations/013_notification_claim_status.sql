CREATE TABLE notifications_new
(
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_event_destination_id INTEGER,
    event_type                  TEXT    NOT NULL,
    event_id                    TEXT    NOT NULL,
    chat_id                     INTEGER NOT NULL,
    message_thread_id           INTEGER NOT NULL DEFAULT 0,
    message_text                TEXT    NOT NULL,
    part_index                  INTEGER NOT NULL DEFAULT 1 CHECK (part_index >= 1 AND part_index <= part_count),
    part_count                  INTEGER NOT NULL DEFAULT 1,
    status                      TEXT    NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
    attempts                    INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at             INTEGER          DEFAULT (strftime('%s', 'now')),
    claimed_at                  INTEGER,
    last_error                  TEXT,
    created_at                  INTEGER          DEFAULT (strftime('%s', 'now')),
    sent_at                     INTEGER,
    FOREIGN KEY (domain_event_destination_id) REFERENCES domain_event_destinations (id),
    UNIQUE (domain_event_destination_id, event_type, event_id, part_index)
);

INSERT INTO notifications_new
(id, domain_event_destination_id, event_type, event_id, chat_id, message_thread_id, message_text, part_index,
 part_count, status, attempts, next_attempt_at, claimed_at, last_error, created_at, sent_at)
SELECT id,
       domain_event_destination_id,
       event_type,
       event_id,
       chat_id,
       message_thread_id,
       message_text,
       part_index,
       part_count,
       status,
       attempts,
       next_attempt_at,
       NULL,
       last_error,
       created_at,
       sent_at
FROM notifications;

DROP TABLE notifications;

ALTER TABLE notifications_new
    RENAME TO notifications;

CREATE INDEX idx_notifications_pending
    ON notifications (status, next_attempt_at, created_at, id);

CREATE INDEX idx_notifications_domain_destination
    ON notifications (domain_event_destination_id);

CREATE UNIQUE INDEX idx_notifications_legacy_event_destination
    ON notifications (event_type, event_id, chat_id, message_thread_id, part_index)
    WHERE domain_event_destination_id IS NULL;

CREATE INDEX idx_notifications_sending
    ON notifications (claimed_at, id)
    WHERE status = 'sending';
