PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- A Telegram destination is identified by the group chat and, for forum
-- topics, by the topic thread inside that chat. Existing destinations are
-- migrated to thread 0, which represents the general chat.
CREATE TABLE telegram_chats_new
(
    chat_id           INTEGER NOT NULL,
    message_thread_id INTEGER NOT NULL DEFAULT 0,
    title             TEXT,
    created_at        INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (chat_id, message_thread_id)
) WITHOUT ROWID;

INSERT INTO telegram_chats_new (chat_id, message_thread_id, title, created_at)
SELECT chat_id, 0, title, created_at
FROM telegram_chats;

CREATE TABLE clan_subscriptions_new
(
    clan_tag          TEXT    NOT NULL,
    chat_id           INTEGER NOT NULL,
    message_thread_id INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (clan_tag, chat_id, message_thread_id),
    FOREIGN KEY (clan_tag) REFERENCES clans(tag) ON DELETE CASCADE,
    FOREIGN KEY (chat_id, message_thread_id)
        REFERENCES telegram_chats_new(chat_id, message_thread_id)
        ON DELETE CASCADE
) WITHOUT ROWID;

INSERT INTO clan_subscriptions_new
    (clan_tag, chat_id, message_thread_id, created_at)
SELECT clan_tag, chat_id, 0, created_at
FROM clan_subscriptions;

CREATE TABLE notifications_new
(
    event_type        TEXT    NOT NULL,
    event_id          TEXT    NOT NULL,
    chat_id           INTEGER NOT NULL,
    message_thread_id INTEGER NOT NULL DEFAULT 0,
    notified_at       INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (event_type, event_id, chat_id, message_thread_id)
) WITHOUT ROWID;

INSERT INTO notifications_new
    (event_type, event_id, chat_id, message_thread_id, notified_at)
SELECT event_type, event_id, chat_id, 0, notified_at
FROM notifications;

DROP TABLE notifications;
DROP TABLE clan_subscriptions;
DROP TABLE telegram_chats;

ALTER TABLE telegram_chats_new RENAME TO telegram_chats;
ALTER TABLE clan_subscriptions_new RENAME TO clan_subscriptions;
ALTER TABLE notifications_new RENAME TO notifications;

COMMIT;

PRAGMA foreign_keys = ON;
