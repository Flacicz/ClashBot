CREATE TABLE IF NOT EXISTS telegram_chats (
    chat_id INTEGER PRIMARY KEY,
    title TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
) WITHOUT ROWID;

CREATE TABLE clan_subscriptions (
    clan_tag TEXT NOT NULL,
    chat_id INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (clan_tag, chat_id),
    FOREIGN KEY (clan_tag) REFERENCES clans(tag) ON DELETE CASCADE,
    FOREIGN KEY (chat_id) REFERENCES telegram_chats(chat_id) ON DELETE CASCADE
) WITHOUT ROWID;

DROP TABLE IF EXISTS notifications;

CREATE TABLE IF NOT EXISTS notifications(
                                            entity_type TEXT NOT NULL,
                                            entity_id INTEGER NOT NULL,
                                            chat_id INTEGER NOT NULL,
                                            notified_at INTEGER DEFAULT (strftime('%s', 'now')),
                                            PRIMARY KEY (entity_type, entity_id, chat_id)
) WITHOUT ROWID;