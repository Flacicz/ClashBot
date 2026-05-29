CREATE TABLE IF NOT EXISTS clans_new
(
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

DROP TABLE clans;

ALTER TABLE clans_new RENAME TO clans;

CREATE TABLE IF NOT EXISTS players (
       tag TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       clan_tag TEXT,
       created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

DROP TABLE players_info;

CREATE TABLE IF NOT EXISTS clan_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clan_tag TEXT NOT NULL,
      type TEXT NOT NULL,
      members_count INTEGER DEFAULT 0,
      clan_level INTEGER DEFAULT 1,
      clan_points INTEGER DEFAULT 0,
      clan_builder_points INTEGER DEFAULT 0,
      clan_capital_points INTEGER DEFAULT 0,
      capital_hall_level INTEGER DEFAULT 1,
      capital_league_id INTEGER,

      required_trophies INTEGER DEFAULT 0,
      required_builder_base_trophies INTEGER DEFAULT 0,
      required_town_hall_level INTEGER DEFAULT 1,

      war_frequency TEXT,
      is_war_log_public INTEGER DEFAULT 0,
      war_win_streak INTEGER DEFAULT 0,
      war_wins INTEGER DEFAULT 0,
      war_ties INTEGER DEFAULT 0,
      war_losses INTEGER DEFAULT 0,
      war_league_id INTEGER,

      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (clan_tag) REFERENCES clans(tag) ON DELETE CASCADE,
      UNIQUE (clan_tag, created_at)
);

CREATE TABLE IF NOT EXISTS player_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_tag TEXT NOT NULL,
    clan_tag TEXT, -- Оставляем NULLable, если игрок ушел из клана
    role TEXT DEFAULT 'member',
    th_level INTEGER DEFAULT 1,
    exp_level INTEGER DEFAULT 1,
    clan_rank INTEGER DEFAULT 0,

    league_id INTEGER, -- ID лиги надежнее текста
    builder_base_league_id INTEGER,

    trophies INTEGER DEFAULT 0,
    builder_base_trophies INTEGER DEFAULT 0,

    donations INTEGER DEFAULT 0,
    donations_received INTEGER DEFAULT 0,

    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (player_tag) REFERENCES players(tag) ON DELETE CASCADE,
    FOREIGN KEY (clan_tag) REFERENCES clans(tag) ON DELETE SET NULL,
    UNIQUE (player_tag, created_at)
);