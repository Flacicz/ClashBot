CREATE TABLE IF NOT EXISTS telegram_chats (
    chat_id INTEGER PRIMARY KEY,
    title TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS clan_subscriptions (
    clan_tag TEXT NOT NULL,
    chat_id INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (clan_tag, chat_id),
    FOREIGN KEY (clan_tag) REFERENCES clans(tag) ON DELETE CASCADE,
    FOREIGN KEY (chat_id) REFERENCES telegram_chats(chat_id) ON DELETE CASCADE
) WITHOUT ROWID;

DROP TABLE IF EXISTS notifications;

CREATE TABLE IF NOT EXISTS notifications(
                                            event_type TEXT NOT NULL,
                                            event_id TEXT NOT NULL,
                                            chat_id INTEGER NOT NULL,
                                            notified_at INTEGER DEFAULT (strftime('%s', 'now')),
                                            PRIMARY KEY (event_type, event_id, chat_id)
) WITHOUT ROWID;