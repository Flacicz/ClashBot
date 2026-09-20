PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE domain_events
(
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type      TEXT    NOT NULL,
    event_id        TEXT    NOT NULL,
    event_payload   TEXT    NOT NULL,
    payload_version INTEGER NOT NULL DEFAULT 1,
    clan_tag        TEXT    NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE (clan_tag, event_type, event_id)
);

CREATE TABLE domain_event_destinations
(
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_event_id   INTEGER NOT NULL,
    chat_id           INTEGER NOT NULL,
    message_thread_id INTEGER NOT NULL DEFAULT 0,
    audience          TEXT    NOT NULL CHECK (audience IN ('players', 'management')),
    subscription_id   INTEGER NOT NULL,
    status            TEXT    NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'materialized', 'cancelled')),
    attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at   INTEGER          DEFAULT (strftime('%s', 'now')),
    last_error        TEXT,
    created_at        INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    materialized_at   INTEGER,
    cancelled_at      INTEGER,
    FOREIGN KEY (domain_event_id) REFERENCES domain_events (id),
    UNIQUE (
            domain_event_id,
            chat_id,
            message_thread_id,
            audience,
            subscription_id
        )
);

CREATE TABLE clan_subscriptions_new
(
    subscription_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    clan_tag          TEXT    NOT NULL,
    chat_id           INTEGER NOT NULL,
    message_thread_id INTEGER NOT NULL DEFAULT 0,
    audience          TEXT    NOT NULL DEFAULT 'players'
        CHECK (audience IN ('players', 'management')),
    created_at        INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE (clan_tag, chat_id, message_thread_id, audience),
    FOREIGN KEY (clan_tag) REFERENCES clans (tag) ON DELETE CASCADE,
    FOREIGN KEY (chat_id, message_thread_id)
        REFERENCES telegram_chats (chat_id, message_thread_id)
        ON DELETE CASCADE
);

INSERT INTO clan_subscriptions_new
    (clan_tag, chat_id, message_thread_id, audience, created_at)
SELECT clan_tag, chat_id, message_thread_id, audience, created_at
FROM clan_subscriptions;

DROP TABLE clan_subscriptions;

ALTER TABLE clan_subscriptions_new
    RENAME TO clan_subscriptions;

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
        CHECK (status IN ('pending', 'failed', 'sent', 'cancelled')),
    attempts                    INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at             INTEGER          DEFAULT (strftime('%s', 'now')),
    last_error                  TEXT,
    created_at                  INTEGER          DEFAULT (strftime('%s', 'now')),
    sent_at                     INTEGER,
    FOREIGN KEY (domain_event_destination_id) REFERENCES domain_event_destinations (id),
    UNIQUE (domain_event_destination_id, event_type, event_id, part_index)
);

INSERT INTO notifications_new
(domain_event_destination_id, event_type, event_id, chat_id, message_thread_id, message_text, part_index, part_count,
 status, attempts, next_attempt_at, created_at, sent_at)
SELECT NULL,
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

CREATE INDEX idx_domain_event_destinations_pending
    ON domain_event_destinations (status, next_attempt_at, created_at, id);

CREATE INDEX idx_domain_event_destinations_subscription
    ON domain_event_destinations (subscription_id);

COMMIT;

PRAGMA foreign_keys = ON;