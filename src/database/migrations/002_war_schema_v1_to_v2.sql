ALTER TABLE clan_info RENAME TO clans;

DROP TABLE IF EXISTS clanwar_seasons;
DROP TABLE IF EXISTS clanwar_summary;
DROP TABLE IF EXISTS clanwar_details;
DROP TABLE IF EXISTS clanwar_league_seasons;
DROP TABLE IF EXISTS clanwar_league_rounds;
DROP TABLE IF EXISTS clanwar_league_attacks;
DROP TABLE IF EXISTS clanwar_league_members;

CREATE TABLE IF NOT EXISTS cwl_seasons (
                                           cwl_season_id INTEGER PRIMARY KEY AUTOINCREMENT,
                                           clan_tag TEXT NOT NULL,
                                           season_id TEXT NOT NULL,
                                           created_at INTEGER DEFAULT (strftime('%s', 'now')),
                                           FOREIGN KEY (clan_tag) REFERENCES clans(tag) ON DELETE CASCADE,
                                           UNIQUE(clan_tag, season_id)
);
CREATE INDEX IF NOT EXISTS idx_cwl_seasons_clan_tag ON cwl_seasons(clan_tag);

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
                                    FOREIGN KEY (clan_tag, season_id) REFERENCES cwl_seasons(clan_tag, season_id),
                                    UNIQUE (war_uid)
);
CREATE INDEX IF NOT EXISTS idx_wars_cwl_season_id ON wars(season_id);
CREATE INDEX IF NOT EXISTS idx_wars_start ON wars(start_time);

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
                                         created_at INTEGER DEFAULT (strftime('%s', 'now')),
                                         FOREIGN KEY (war_id) REFERENCES wars(war_id) ON DELETE CASCADE,
                                         UNIQUE(war_id, side),
                                         UNIQUE(war_id, clan_tag)
);
CREATE INDEX IF NOT EXISTS idx_war_clans_war_id ON war_clans(war_id);
CREATE INDEX IF NOT EXISTS idx_war_clans_tag ON war_clans(clan_tag);

CREATE TABLE IF NOT EXISTS war_members (
                                           war_member_id INTEGER PRIMARY KEY AUTOINCREMENT,
                                           war_id INTEGER NOT NULL,
                                           war_clan_id INTEGER NOT NULL,
                                           player_tag TEXT NOT NULL,
                                           player_name TEXT NOT NULL,
                                           townhall_level INTEGER NOT NULL,
                                           map_position INTEGER NOT NULL,
                                           created_at INTEGER DEFAULT (strftime('%s', 'now')),
                                           FOREIGN KEY (war_id) REFERENCES wars(war_id) ON DELETE CASCADE,
                                           FOREIGN KEY (war_clan_id) REFERENCES war_clans(war_clan_id) ON DELETE CASCADE,
                                           UNIQUE(war_id, player_tag)
);
CREATE INDEX IF NOT EXISTS idx_war_members_war_id ON war_members(war_id);
CREATE INDEX IF NOT EXISTS idx_war_members_war_clan_id ON war_members(war_clan_id);
CREATE INDEX IF NOT EXISTS idx_members_player ON war_members(player_tag);

CREATE TABLE IF NOT EXISTS cwl_season_members (
                                                  cwl_season_id INTEGER NOT NULL,
                                                  season_id TEXT NOT NULL,
                                                  clan_tag TEXT NOT NULL,
                                                  player_tag TEXT NOT NULL,
                                                  player_name TEXT NOT NULL,
                                                  townhall_level INTEGER NOT NULL,
                                                  created_at INTEGER DEFAULT (strftime('%s', 'now')),
                                                  PRIMARY KEY (cwl_season_id, player_tag),
                                                  FOREIGN KEY (cwl_season_id) REFERENCES cwl_seasons(cwl_season_id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_cwl_season_members_id ON cwl_season_members(cwl_season_id);

CREATE TABLE IF NOT EXISTS attacks (
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
                                       created_at INTEGER DEFAULT (strftime('%s', 'now')),
                                       FOREIGN KEY (war_id) REFERENCES wars(war_id) ON DELETE CASCADE,
                                       FOREIGN KEY (attacker_war_clan_id) REFERENCES war_clans(war_clan_id),
                                       FOREIGN KEY (defender_war_clan_id) REFERENCES war_clans(war_clan_id),
                                       UNIQUE(war_id, order_num)
);
CREATE INDEX IF NOT EXISTS idx_attacks_war ON attacks(war_id);
CREATE INDEX IF NOT EXISTS idx_attacks_attacker ON attacks(attacker_tag);
CREATE INDEX IF NOT EXISTS idx_attacks_defender ON attacks(defender_tag);