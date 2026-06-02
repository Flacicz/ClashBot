PRAGMA foreign_keys = OFF;

-- 1. Пересоздание таблицы кланов
CREATE TABLE IF NOT EXISTS clans_new (
                                         tag                TEXT PRIMARY KEY,
                                         name               TEXT NOT NULL,
                                         description        TEXT,
                                         location_id        INTEGER,
                                         location_name      TEXT,
                                         chat_language_id   INTEGER,
                                         chat_language      TEXT,
                                         is_family_friendly INTEGER DEFAULT 0,
                                         created_at         INTEGER DEFAULT (strftime('%s', 'now'))
);

DROP TABLE IF EXISTS clans;
ALTER TABLE clans_new RENAME TO clans;

-- 2. Пересоздание таблицы игроков
DROP TABLE IF EXISTS players_info;

CREATE TABLE IF NOT EXISTS players (
                                       tag        TEXT PRIMARY KEY,
                                       name       TEXT NOT NULL,
                                       clan_tag   TEXT,
                                       created_at INTEGER DEFAULT (strftime('%s', 'now')),
                                       FOREIGN KEY (clan_tag) REFERENCES clans(tag) ON DELETE SET NULL
);

PRAGMA foreign_keys = ON;

-- Индекс для быстрого поиска игроков конкретного клана (логика диффа составов)
CREATE INDEX IF NOT EXISTS idx_players_clan_tag ON players(clan_tag);


-- 3. Создание таблицы снапшотов кланов (CASCADE сохранен)
CREATE TABLE IF NOT EXISTS clan_snapshots (
                                              id                             INTEGER PRIMARY KEY AUTOINCREMENT,
                                              clan_tag                       TEXT NOT NULL,
                                              type                           TEXT NOT NULL,
                                              members_count                  INTEGER DEFAULT 0,
                                              clan_level                     INTEGER DEFAULT 1,
                                              clan_points                    INTEGER DEFAULT 0,
                                              clan_builder_points            INTEGER DEFAULT 0,
                                              clan_capital_points            INTEGER DEFAULT 0,
                                              capital_hall_level             INTEGER DEFAULT 1,
                                              capital_league_id              INTEGER,
                                              required_trophies              INTEGER DEFAULT 0,
                                              required_builder_base_trophies INTEGER DEFAULT 0,
                                              required_town_hall_level       INTEGER DEFAULT 1,
                                              war_frequency                  TEXT,
                                              is_war_log_public              INTEGER DEFAULT 0,
                                              war_win_streak                 INTEGER DEFAULT 0,
                                              war_wins                       INTEGER DEFAULT 0,
                                              war_ties                       INTEGER DEFAULT 0,
                                              war_losses                     INTEGER DEFAULT 0,
                                              war_league_id                  INTEGER,
                                              created_at                     INTEGER DEFAULT (strftime('%s', 'now')),
                                              FOREIGN KEY (clan_tag) REFERENCES clans(tag) ON DELETE CASCADE
);

-- Составной индекс для моментального получения истории конкретного клана
CREATE INDEX IF NOT EXISTS idx_clan_snapshots_lookup
    ON clan_snapshots (clan_tag, created_at DESC);


-- 4. Создание таблицы снапшотов игроков (NO ACTION для сохранения истории аналитики)
CREATE TABLE IF NOT EXISTS player_snapshots (
                                                id                     INTEGER PRIMARY KEY AUTOINCREMENT,
                                                player_tag             TEXT NOT NULL,
                                                clan_tag               TEXT,
                                                role                   TEXT DEFAULT 'member',
                                                th_level               INTEGER DEFAULT 1,
                                                exp_level              INTEGER DEFAULT 1,
                                                clan_rank              INTEGER DEFAULT 0,
                                                league_id              INTEGER,
                                                builder_base_league_id INTEGER,
                                                trophies               INTEGER DEFAULT 0,
                                                builder_base_trophies  INTEGER DEFAULT 0,
                                                donations              INTEGER DEFAULT 0,
                                                donations_received     INTEGER DEFAULT 0,
                                                created_at             INTEGER DEFAULT (strftime('%s', 'now')),
                                                FOREIGN KEY (player_tag) REFERENCES players(tag) ON DELETE NO ACTION,
                                                FOREIGN KEY (clan_tag) REFERENCES clans(tag) ON DELETE SET NULL
);

-- Главный составной индекс для поиска последней статистики игрока
CREATE INDEX IF NOT EXISTS idx_player_snapshots_lookup
    ON player_snapshots (player_tag, created_at DESC);

-- Индекс для аналитики доната/активности внутри конкретного клана за период
CREATE INDEX IF NOT EXISTS idx_player_snapshots_clan_history
    ON player_snapshots (clan_tag, created_at DESC);