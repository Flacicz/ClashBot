CREATE TABLE IF NOT EXISTS clan_info(
    tag TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    members INTEGER DEFAULT 0,

    clan_level INTEGER DEFAULT 1,
    clan_points INTEGER DEFAULT 0,
    clan_builder_points INTEGER DEFAULT 0,
    clan_capital_points INTEGER DEFAULT 0,
    capital_hall_level INTEGER DEFAULT 1,
    capital_league TEXT DEFAULT 'Unranked',

    required_trophies INTEGER DEFAULT 0,
    required_builder_base_trophies INTEGER DEFAULT 0,
    required_town_hall_level INTEGER DEFAULT 1,

    war_frequency TEXT,
    is_war_log_public INTEGER DEFAULT 0,
    war_win_streak INTEGER DEFAULT 0,
    war_wins INTEGER DEFAULT 0,
    war_ties INTEGER DEFAULT 0,
    war_losses INTEGER DEFAULT 0,
    war_league TEXT DEFAULT 'Unranked',

    location_name TEXT,
    chat_language TEXT,

    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS players_info(
    tag TEXT PRIMARY KEY,
    clan_tag TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'member',

    th_level INTEGER DEFAULT 1,
    exp_level INTEGER DEFAULT 1,
    clan_rank INTEGER DEFAULT 0,

    league_tier TEXT DEFAULT 'Unranked',
    trophies INTEGER DEFAULT 0,
    builder_base_trophies INTEGER DEFAULT 0,

    donations INTEGER DEFAULT 0,
    donations_received INTEGER DEFAULT 0,

    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),

    FOREIGN KEY (clan_tag) REFERENCES clan_info(tag) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS raid_summary(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clan_tag TEXT NOT NULL,
    date TEXT NOT NULL,
    state TEXT NOT NULL,
    total_loot INTEGER DEFAULT 0,
    raids_completed INTEGER DEFAULT 0,
    total_attacks INTEGER DEFAULT 0,
    enemy_districts_destroyed INTEGER DEFAULT 0,
    offensive_reward INTEGER DEFAULT 0,
    defensive_reward INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (clan_tag) REFERENCES clan_info(tag) ON DELETE CASCADE,
    UNIQUE(clan_tag, date)
);

CREATE TABLE IF NOT EXISTS raid_details(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raid_id INTEGER NOT NULL,
    player_tag TEXT NOT NULL,
    name TEXT NOT NULL,
    attacks_count INTEGER DEFAULT 0,
    total_loot INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (raid_id) REFERENCES raid_summary(id) ON DELETE CASCADE,
    UNIQUE (raid_id, player_tag)
);

CREATE TABLE IF NOT EXISTS clanwar_seasons(
      season_id TEXT PRIMARY KEY,
      clan_tag TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS clanwar_summary(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id TEXT NOT NULL,
    prep_start_time TEXT NOT NULL,
    clan_tag TEXT NOT NULL,
    opponent_tag TEXT NOT NULL,
    opponent_name TEXT,
    team_size INTEGER NOT NULL,
    clan_stars INTEGER DEFAULT 0,
    opp_stars INTEGER DEFAULT 0,
    result TEXT CHECK(result IN ('win', 'lose', 'tie', 'ongoing')),
    FOREIGN KEY (season_id) REFERENCES clanwar_seasons(season_id) ON DELETE CASCADE,
    UNIQUE(prep_start_time, clan_tag)
);

CREATE TABLE IF NOT EXISTS clanwar_details(
    attack_id INTEGER PRIMARY KEY AUTOINCREMENT,
    war_id INTEGER NOT NULL,
    attacker_tag TEXT NOT NULL,
    attacker_name TEXT NOT NULL,
    attacker_th INTEGER NOT NULL,
    map_position INTEGER NOT NULL,
    defender_tag TEXT,
    defender_th INTEGER NOT NULL,
    stars INTEGER DEFAULT 0,
    destruction INTEGER DEFAULT 0,
    duration INTEGER DEFAULT 0,
    order_num INTEGER,
    rules TEXT NOT NULL,
    is_opponent_attack INTEGER DEFAULT 0,
    FOREIGN KEY (war_id) REFERENCES clanwar_summary(id) ON DELETE CASCADE,
    UNIQUE(war_id, attacker_tag, order_num)
);

CREATE TABLE IF NOT EXISTS clanwar_league_seasons(
    season_id TEXT PRIMARY KEY,
    clan_tag TEXT NOT NULL,
    league TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS clanwar_league_rounds(
    war_tag TEXT PRIMARY KEY,
    season_id TEXT NOT NULL,
    round INTEGER NOT NULL,
    opponent_tag TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (season_id) REFERENCES clanwar_league_seasons(season_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clanwar_league_attacks(
    attack_id INTEGER PRIMARY KEY AUTOINCREMENT,
    war_tag TEXT NOT NULL,
    attacker_tag TEXT NOT NULL,
    attacker_clan_tag TEXT NOT NULL,
    attacker_map_position INTEGER NOT NULL,
    defender_tag TEXT NOT NULL,
    defender_map_position INTEGER NOT NULL,
    rules TEXT NOT NULL,
    stars INTEGER NOT NULL,
    destruction INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    attacker_th INTEGER NOT NULL,
    defender_th INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (war_tag) REFERENCES clanwar_league_rounds(war_tag) ON DELETE CASCADE,
    UNIQUE(war_tag, attacker_tag)
);

CREATE TABLE IF NOT EXISTS clanwar_league_members(
    player_tag TEXT NOT NULL,
    season_id TEXT NOT NULL,
    name TEXT NOT NULL,
    clan_tag TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (player_tag, season_id)
);

CREATE TABLE IF NOT EXISTS notifications(
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    notified_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (entity_type, entity_id)
);
