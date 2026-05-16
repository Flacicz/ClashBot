ALTER TABLE clan_info RENAME TO clans;

DROP TABLE IF EXISTS clanwar_seasons;
DROP TABLE IF EXISTS clanwar_summary;
DROP TABLE IF EXISTS clanwar_details;
DROP TABLE IF EXISTS clanwar_league_seasons;
DROP TABLE IF EXISTS clanwar_league_rounds;
DROP TABLE IF EXISTS clanwar_league_attacks;
DROP TABLE IF EXISTS clanwar_league_members;

PRAGMA foreign_keys = OFF;

CREATE TABLE players_info_new (
      tag TEXT PRIMARY KEY,
      clan_tag TEXT,
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
      FOREIGN KEY (clan_tag) REFERENCES clans(tag) ON DELETE SET NULL
);

INSERT INTO players_info_new SELECT * FROM players_info;

DROP TABLE IF EXISTS players_info;

ALTER TABLE players_info_new RENAME TO players_info;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cwl_seasons (
     clan_tag TEXT NOT NULL,
     season_id TEXT NOT NULL,
     created_at INTEGER DEFAULT (strftime('%s', 'now')),
     PRIMARY KEY (clan_tag, season_id),
     FOREIGN KEY (clan_tag) REFERENCES clans(clan_tag) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wars (
      war_id INTEGER PRIMARY KEY AUTOINCREMENT,
      war_uid TEXT NOT NULL UNIQUE,
      clan_tag TEXT NOT NULL,
      state TEXT NOT NULL,
      war_type TEXT NOT NULL CHECK(war_type IN ('regular', 'cwl', 'friendly')),
      team_size INTEGER NOT NULL,
      attacks_per_member INTEGER NOT NULL DEFAULT 2,
      preparation_start_time INTEGER NOT NULL,
      start_time INTEGER,
      end_time INTEGER,
      season_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (clan_tag, season_id) REFERENCES cwl_seasons(clan_tag, season_id)
);

CREATE TABLE IF NOT EXISTS war_clans (
       war_clan_id INTEGER PRIMARY KEY AUTOINCREMENT,
       war_id INTEGER NOT NULL,
       side TEXT NOT NULL CHECK(side IN ('home', 'opponent')),
       clan_tag TEXT NOT NULL,
       clan_name TEXT NOT NULL,
       clan_level INTEGER,
       attacks_count INTEGER DEFAULT 0,
       stars INTEGER DEFAULT 0,
       destruction_percentage REAL DEFAULT 0,
       FOREIGN KEY (war_id) REFERENCES wars(war_id) ON DELETE CASCADE,
       UNIQUE(war_id, side),
       UNIQUE(war_id, clan_tag)
);

CREATE TABLE war_members (
     war_member_id INTEGER PRIMARY KEY AUTOINCREMENT,
     war_id INTEGER NOT NULL,
     war_clan_id INTEGER NOT NULL,
     player_tag TEXT NOT NULL,
     player_name TEXT NOT NULL,
     townhall_level INTEGER NOT NULL,
     map_position INTEGER NOT NULL,
     FOREIGN KEY (war_id) REFERENCES wars(war_id) ON DELETE CASCADE,
     FOREIGN KEY (war_clan_id) REFERENCES war_clans(war_clan_id) ON DELETE CASCADE,
     UNIQUE(war_id, player_tag)
);

CREATE TABLE IF NOT EXISTS cwl_season_members (
      season_id TEXT NOT NULL,
      clan_tag TEXT NOT NULL,
      player_tag TEXT NOT NULL,
      player_name TEXT NOT NULL,
      townhall_level INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (season_id, player_tag),
      FOREIGN KEY (clan_tag, season_id) REFERENCES cwl_seasons(clan_tag, season_id) ON DELETE CASCADE
);

CREATE TABLE attacks (
     attack_id INTEGER PRIMARY KEY AUTOINCREMENT,
     war_id INTEGER NOT NULL,
     attacker_war_clan_id INTEGER NOT NULL,
     defender_war_clan_id INTEGER NOT NULL,
     attacker_tag TEXT NOT NULL,
     defender_tag TEXT NOT NULL,
     attacker_position INTEGER NOT NULL,
     defender_position INTEGER NOT NULL,
     stars INTEGER NOT NULL CHECK(stars BETWEEN 0 AND 3),
     destruction_percentage REAL NOT NULL,
     order_num INTEGER NOT NULL CHECK(order_num > 0),
     duration INTEGER NOT NULL,
     FOREIGN KEY (war_id) REFERENCES wars(war_id) ON DELETE CASCADE,
     FOREIGN KEY (attacker_war_clan_id) REFERENCES war_clans(war_clan_id),
     FOREIGN KEY (defender_war_clan_id) REFERENCES war_clans(war_clan_id),
     UNIQUE(war_id, order_num)
);

CREATE INDEX idx_wars_start ON wars(start_time);
CREATE INDEX idx_war_clans_tag ON war_clans(clan_tag);
CREATE INDEX idx_members_player ON war_members(player_tag);
CREATE INDEX idx_attacks_war ON attacks(war_id);
CREATE INDEX idx_attacks_attacker ON attacks(attacker_tag);
CREATE INDEX idx_attacks_defender ON attacks(defender_tag);
CREATE INDEX idx_attacks_order ON attacks(order_num);