#include "../database/tableManager.h"

#include "../../include/database/database.h"

#include <string>
#include <vector>

TableManager::TableManager(Database* db): db(db) {}

bool TableManager::initClanTable() {
	std::string sql = R"(
		CREATE TABLE IF NOT EXISTS clan_info(
			tag TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			members INTEGER DEFAULT 1,
			clan_level INTEGER DEFAULT 1,
			capital_hall_level INTEGER DEFAULT 1,
			capital_league TEXT NOT NULL,
			war_league TEXT NOT NULL,
			war_win_streak INTEGER DEFAULT 0,
			war_wins INTEGER DEFAULT 0,
			war_ties INTEGER DEFAULT 0,
			war_losses INTEGER DEFAULT 0,
			created_at TIMESTAMP DEFAULT (strftime('%s', 'now')),
			updated_at TIMESTAMP DEFAULT (strftime('%s', 'now'))
		);
	)";

	return db->execute(sql);
}

bool TableManager::initPlayersInfoTable() {
	std::string sql = R"(
		CREATE TABLE IF NOT EXISTS players_info(
			tag TEXT PRIMARY KEY,
			clan_tag TEXT NOT NULL,
			name TEXT NOT NULL,
			role TEXT NOT NULL,
			th_level INTEGER DEFAULT 1,
			league_tier TEXT NOT NULL,
			trophies INTEGER DEFAULT 0,
			donations INTEGER DEFAULT 0,
			donations_received INTEGER DEFAULT 0,
			created_at TIMESTAMP DEFAULT (strftime('%s', 'now')),
			updated_at TIMESTAMP DEFAULT (strftime('%s', 'now')),
			FOREIGN KEY (clan_tag) REFERENCES clan_info(tag) ON DELETE SET NULL
		)
	)";

	return db->execute(sql);
}

bool TableManager::initRaidSummary() {
	std::string sql = R"(
		CREATE TABLE IF NOT EXISTS raid_summary(
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			clan_tag TEXT NOT NULL,
			date DATE NOT NULL,
			total_loot INTEGER DEFAULT 0,
			raids_completed INTEGER DEFAULT 0,
			total_attacks INTEGER DEFAULT 0,
			enemy_districts_destroyed INTEGER DEFAULT 0,
			offensive_reward INTEGER DEFAULT 0,
			defensive_reward INTEGER DEFAULT 0,
			created_at TIMESTAMP DEFAULT (strftime('%s', 'now')),
			FOREIGN KEY (clan_tag) REFERENCES clan_info(tag) ON DELETE CASCADE,
			UNIQUE(clan_tag, date)
		)
	)";

	return db->execute(sql);
}

bool TableManager::initRaidDetails() {
	std::string sql = R"(
		CREATE TABLE IF NOT EXISTS raid_details(
			player_id INTEGER PRIMARY KEY AUTOINCREMENT,
			raid_id INTEGER NOT NULL,
			player_tag TEXT NOT NULL,
			name TEXT NOT NULL,
			attacks_count INTEGER DEFAULT 0,
			total_loot INTEGER DEFAULT 0,
			created_at TIMESTAMP DEFAULT (strftime('%s', 'now')),
			FOREIGN KEY (raid_id) REFERENCES raid_info(id) ON DELETE CASCADE,
			FOREIGN KEY (player_tag) REFERENCES players_info(tag) ON DELETE CASCADE,
			UNIQUE (raid_id, player_tag)
		)
	)";

	return db->execute(sql);
}

bool TableManager::initClanwarSummary() {
	std::string sql = R"(
		CREATE TABLE IF NOT EXISTS clanwar_summary(
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			clan_tag TEXT NOT NULL,
			date DATE NOT NULL,
			team_size INTEGER NOT NULL,
			attacks INTEGER DEFAULT 0,
			stars INTEGER DEFAULT 0,
			result TEXT NOT NULL CHECK(result IN ('win', 'lose', 'tie')),
			exp_earned INTEGER DEFAULT 0,
			destruction_percentage INTEGER DEFAULT 0,
			created_at TIMESTAMP DEFAULT (strftime('%s', 'now')),
			FOREIGN KEY (clan_tag) REFERENCES clan_info(tag) ON DELETE CASCADE,
			UNIQUE(clan_tag, date)
		)
	)";

	return db->execute(sql);
}

bool TableManager::initClanwarDetails() {
	std::string sql = R"(
		CREATE TABLE IF NOT EXISTS clanwar_details(
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			clanwar_id INTEGER NOT NULL,
			player_tag TEXT NOT NULL,
			attacks_count INTEGER DEFAULT 0,
			stars_count INTEGER DEFAULT 0,
			mapPosition INTEGER NOT NULL,
			rules TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT (strftime('%s', 'now')),
			FOREIGN KEY (clanwar_id) REFERENCES cw_info(id) ON DELETE CASCADE,
			FOREIGN KEY (player_tag) REFERENCES players_info(tag) ON DELETE CASCADE,
			UNIQUE (clanwar_id, player_tag)
		)
	)";

	return db->execute(sql);
}

bool TableManager::initAllTables() {
	return initClanTable() && initPlayersInfoTable() && initRaidSummary() && initRaidDetails() &&
		   initClanwarSummary() && initClanwarDetails();
}

bool TableManager::dropAllTables() {
	std::string sql = "DROP TABLE IF EXISTS ";
	std::vector<std::vector<std::string>> names = getAllTableNames();

	for (int i = 0; i < names.size(); i++) {
		if (names[i][0] == "sqlite_sequence") continue;

		if (!db->execute(sql + names[i][0])) return false;
	}

	return true;
}

std::vector<std::vector<std::string>> TableManager::getAllTableNames() {
	std::string sql = "SELECT name FROM sqlite_master WHERE type = 'table'";

	return db->query(sql).rows;
}