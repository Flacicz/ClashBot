CREATE TABLE IF NOT EXISTS clan_raids(
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     clan_tag TEXT NOT NULL,
     start_time INTEGER NOT NULL,
     end_time INTEGER NOT NULL,
     state TEXT NOT NULL,

     total_loot INTEGER DEFAULT 0,
     raids_completed INTEGER DEFAULT 0,
     total_attacks INTEGER DEFAULT 0,
     enemy_districts_destroyed INTEGER DEFAULT 0,
     offensive_reward INTEGER DEFAULT 0,
     defensive_reward INTEGER DEFAULT 0,

     created_at INTEGER DEFAULT (strftime('%s', 'now')),

     FOREIGN KEY (clan_tag) REFERENCES clans(tag) ON DELETE CASCADE,
     UNIQUE(clan_tag, start_time)
);

CREATE TABLE IF NOT EXISTS player_raid_snapshots(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raid_id INTEGER NOT NULL,
    player_tag TEXT NOT NULL,

    attacks_count INTEGER DEFAULT 0,
    bonus_attacks INTEGER DEFAULT 0,
    total_loot INTEGER DEFAULT 0,

    created_at INTEGER DEFAULT (strftime('%s', 'now')),

    FOREIGN KEY (raid_id) REFERENCES clan_raids(id) ON DELETE CASCADE,
    FOREIGN KEY (player_tag) REFERENCES players(tag) ON DELETE CASCADE,
    UNIQUE (raid_id, player_tag)
);

DROP TABLE raid_details;
DROP TABLE raid_summary;