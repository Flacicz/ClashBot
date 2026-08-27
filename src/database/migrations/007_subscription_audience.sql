PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE clan_subscriptions_new
(
    clan_tag          TEXT    NOT NULL,
    chat_id           INTEGER NOT NULL,
    message_thread_id INTEGER NOT NULL DEFAULT 0,
    audience          TEXT    NOT NULL DEFAULT 'players'
        CHECK (audience IN ('players', 'management')),
    created_at        INTEGER          DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (clan_tag, chat_id, message_thread_id, audience),
    FOREIGN KEY (clan_tag) REFERENCES clans (tag) ON DELETE CASCADE,
    FOREIGN KEY (chat_id, message_thread_id)
        REFERENCES telegram_chats (chat_id, message_thread_id)
        ON DELETE CASCADE
) WITHOUT ROWID;

INSERT INTO clan_subscriptions_new
    (clan_tag, chat_id, message_thread_id, audience, created_at)
SELECT clan_tag, chat_id, message_thread_id, 'players', created_at
FROM clan_subscriptions;

DROP TABLE clan_subscriptions;

ALTER TABLE clan_subscriptions_new
    RENAME TO clan_subscriptions;

COMMIT;

PRAGMA foreign_keys = ON;
