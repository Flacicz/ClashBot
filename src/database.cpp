#include "../include/database.h"

#include <iostream>

Database::Database(const std::string& path) : db(nullptr), pathToDb(path) {
	if (sqlite3_open(path.c_str(), &db) != SQLITE_OK) {
		std::cerr << "Не удалось открыть/создать базу: " << sqlite3_errmsg(db) << std::endl;
		return;
	}

	std::cout << "База успешно открыта!" << std::endl;

	execute("PRAGMA foreign_keys = ON;");
	execute("PRAGMA journal_mode = WAL;");
}

Database::~Database() {
	if (db) {
		sqlite3_close(db);
		std::cout << "База закрыта!" << std::endl;
	}
}

void Database::initDatabase() {
	std::string clanTable = R"(
		CREATE TABLE IF NOT EXISTS clan_info(
			tag TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			members INTEGER DEFAULT 0,
			clan_level INTEGER DEFAULT 1,
			capital_hall_level INTEGER DEFAULT 0,
			capital_league TEXT,
			war_league TEXT,
			war_win_streak INTEGER DEFAULT 0,
			war_wins INTEGER DEFAULT 0,
			war_ties INTEGER DEFAULT 0,
			war_losses INTEGER DEFAULT 0,
			created_at TIMESTAMP DEFAULT (strftime('%s', 'now')),
			updated_at TIMESTAMP DEFAULT (strftime('%s', 'now'))
		);
	)";

	std::string playersTable = R"(
		CREATE TABLE IF NOT EXISTS players_info(
			tag TEXT PRIMARY KEY,
			clan_tag TEXT,
			name TEXT NOT NULL,
			role TEXT,
			th_level INTEGER DEFAULT 1,
			league_tier TEXT,
			trophies INTEGER DEFAULT 0,
			donations INTEGER DEFAULT 0,
			donations_received INTEGER DEFAULT 0,
			war_stars INTEGER DEFAULT 0,
			created_at TIMESTAMP DEFAULT (strftime('%s', 'now')),
			updated_at TIMESTAMP DEFAULT (strftime('%s', 'now')),
			FOREIGN KEY (clan_tag) REFERENCES clan_info(tag) ON DELETE SET NULL
		)
	)";

	std::string clanRaidsTable = R"(
		CREATE TABLE IF NOT EXISTS raid_info(
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			clan_tag TEXT NOT NULL,
			date DATE NOT NULL,
			total_loot INTEGER DEFAULT 0,
			totalAttacks INTEGER DEFAULT 0,
			offensiveReward INTEGER DEFAULT 0,
			defensiveReward INTEGER DEFAULT 0,
			capital_rank INTEGER,
			created_at TIMESTAMP DEFAULT (strftime('%s', 'now')),
			FOREIGN KEY (clan_tag) REFERENCES clan_info(tag) ON DELETE CASCADE,
			UNIQUE(clan_tag, date)
		)
	)";

	std::string playersRaidsTable = R"(
		CREATE TABLE IF NOT EXISTS players_raid_info(
			player_id INTEGER PRIMARY KEY AUTOINCREMENT,
			raid_id INTEGER NOT NULL,
			player_tag TEXT NOT NULL,
			attacks_count INTEGER DEFAULT 0,
			total_loot INTEGER DEFAULT 0,
			created_at TIMESTAMP DEFAULT (strftime('%s', 'now')),
			FOREIGN KEY (raid_id) REFERENCES raid_info(id) ON DELETE CASCADE,
			FOREIGN KEY (player_tag) REFERENCES players_info(tag) ON DELETE CASCADE,
			UNIQUE (raid_id, player_tag)
		)
	)";

	std::string clanWarTable = R"(
		CREATE TABLE IF NOT EXISTS cw_info(
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			clan_tag TEXT NOT NULL,
			date DATE NOT NULL,
			team_size INTEGER,
			attacks INTEGER DEFAULT 0,
			stars INTEGER DEFAULT 0,
			result TEXT NOT NULL CHECK(result IN ('win', 'lose', 'tie')),
			exp_earned INTEGER,
			destruction_percentage INTEGER DEFAULT 0,
			created_at TIMESTAMP DEFAULT (strftime('%s', 'now')),
			FOREIGN KEY (clan_tag) REFERENCES clan_info(tag) ON DELETE CASCADE,
			UNIQUE(clan_tag, date)
		)
	)";

	std::string playersCWTable = R"(
		CREATE TABLE IF NOT EXISTS players_cw_info(
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			cw_id INTEGER NOT NULL,
			player_tag TEXT NOT NULL,
			attacks_count INTEGER DEFAULT 0,
			stars_count INTEGER DEFAULT 0,
			mapPosition INTEGER,
			rules TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT (strftime('%s', 'now')),
			FOREIGN KEY (cw_id) REFERENCES cw_info(id) ON DELETE CASCADE,
			FOREIGN KEY (player_tag) REFERENCES players_info(tag) ON DELETE CASCADE,
			UNIQUE (cw_id, player_tag)
		)
	)";

	execute(clanTable);
	execute(playersTable);
	execute(clanRaidsTable);
	execute(playersRaidsTable);
	execute(clanWarTable);
	execute(playersCWTable);
}

void Database::execute(const std::string& sql) {
	char* err = nullptr;

	if (sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &err) != SQLITE_OK) {
		std::cerr << "Не удалось выполнить запрос: " << err << std::endl;
		sqlite3_free(err);
	}
}

Database::QueryResult Database::query(const std::string& sql) {
	QueryResult result;
	sqlite3_stmt* statement;

	if (sqlite3_prepare_v2(db, sql.c_str(), -1, &statement, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось открыть/создать базу: " << sqlite3_errmsg(db) << std::endl;
		return result;
	}

	for (int i = 0; i < sqlite3_column_count(statement); i++) {
		result.columns.push_back(sqlite3_column_name(statement, i));
	}

	while (sqlite3_step(statement) == SQLITE_ROW) {

		std::vector<std::string> row;
		for (int i = 0; i < sqlite3_column_count(statement); i++) {
			row.push_back((const char*)sqlite3_column_text(statement, i));
		}

		result.rows.push_back(row);
	}

	sqlite3_finalize(statement);
	return result;
}