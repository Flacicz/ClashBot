PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE notifications_new
(
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type        TEXT    NOT NULL,
    event_id          TEXT    NOT NULL,
    chat_id           INTEGER NOT NULL,
    message_thread_id INTEGER NOT NULL DEFAULT 0,
    message_text      TEXT    NOT NULL,
    part_index        INTEGER NOT NULL DEFAULT 1 CHECK (part_index >= 1 AND part_index <= part_count),
    part_count        INTEGER NOT NULL DEFAULT 1,
    status            TEXT    NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'failed', 'sent')),
    attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at   INTEGER          DEFAULT (strftime('%s', 'now')),
    last_error        TEXT,
    created_at        INTEGER          DEFAULT (strftime('%s', 'now')),
    sent_at           INTEGER,
    UNIQUE (
            event_type,
            event_id,
            chat_id,
            message_thread_id,
            part_index
        )
);

INSERT INTO notifications_new
(event_type, event_id, chat_id, message_thread_id, message_text, part_index, part_count, status, attempts,
 next_attempt_at, created_at, sent_at)
SELECT event_type,
       event_id,
       chat_id,
       message_thread_id,
       '',
       1,
       1,
       'sent',
       1,
       NULL,
       notified_at,
       notified_at
FROM notifications;

DROP TABLE notifications;

ALTER TABLE notifications_new
    RENAME TO notifications;

CREATE INDEX idx_notifications_pending
    ON notifications (status, next_attempt_at, created_at, id);

COMMIT;

PRAGMA foreign_keys = ON;
