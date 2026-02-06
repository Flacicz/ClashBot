#include "../database/database.h"
#include "../models/models.h"

#include <iostream>
#include <chrono>
#include <string>

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

void Database::execute(const std::string& sql) {
	char* err = nullptr;

	if (sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &err) != SQLITE_OK) {
		std::cerr << "Не удалось выполнить запрос: " << err << std::endl;
		sqlite3_free(err);
	}
}

bool Database::executePrepeared(sqlite3_stmt* stmt) const {
	int result = sqlite3_step(stmt);

	if (result != SQLITE_DONE && result != SQLITE_ROW) {
		std::cerr << "Не удалось выполнить запрос: " << sqlite3_errmsg(getDBInstance()) << std::endl;
		return false;
	}

	return true;
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

Database::QueryResult Database::queryWithParam(const std::string& sql, const std::string& param) {
	QueryResult result;
	sqlite3_stmt* stmt;

	if (sqlite3_prepare_v2(getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(getDBInstance()) << std::endl;
		return result;
	}

	sqlite3_bind_text(stmt, 1, param.c_str(), -1, SQLITE_TRANSIENT);

	while (sqlite3_step(stmt) == SQLITE_ROW) {

		std::vector<std::string> row;
		for (int i = 0; i < sqlite3_column_count(stmt); i++) {
			row.push_back((const char*)sqlite3_column_text(stmt, i));
		}

		result.rows.push_back(row);
	}

	sqlite3_finalize(stmt);
	return result;
}

bool Database::insertOrUpdateClanInfo(const ClanInfo& clanInfo) {
	sqlite3_stmt* stmt;

	std::string sql = R"(
		INSERT INTO clan_info(tag, name, members, clan_level, capital_hall_level, capital_league, war_league,
							  war_win_streak, war_wins, war_ties, war_losses, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(tag) DO UPDATE SET
			name = excluded.name,
			members = excluded.members,
			clan_level = excluded.clan_level,
			capital_hall_level = excluded.capital_hall_level,
			capital_league = excluded.capital_league,
			war_league = excluded.war_league,
			war_win_streak = excluded.war_win_streak,
			war_wins = excluded.war_wins,
			war_ties = excluded.war_ties,
			war_losses = excluded.war_losses,
			updated_at = excluded.updated_at
	)";

	if (sqlite3_prepare_v2(getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(getDBInstance()) << std::endl;
		return false;
	}

	auto now = std::chrono::system_clock::now();
	auto duration = now.time_since_epoch();

	sqlite3_reset(stmt);

	sqlite3_bind_text(stmt, 1, clanInfo.tag.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_text(stmt, 2, clanInfo.name.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_int(stmt, 3, clanInfo.members);
	sqlite3_bind_int(stmt, 4, clanInfo.clanLevel);
	sqlite3_bind_int(stmt, 5, clanInfo.capitalHallLevel);
	sqlite3_bind_text(stmt, 6, clanInfo.capitalLeague.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_text(stmt, 7, clanInfo.warLeague.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_int(stmt, 8, clanInfo.warWinStreak);
	sqlite3_bind_int(stmt, 9, clanInfo.warWins);
	sqlite3_bind_int(stmt, 10, clanInfo.warTies);
	sqlite3_bind_int(stmt, 11, clanInfo.warLosses);
	sqlite3_bind_int64(stmt, 12, std::chrono::duration_cast<std::chrono::microseconds>(duration).count());

	bool result = executePrepeared(stmt);
	sqlite3_finalize(stmt);

	return result;
}

bool Database::insertOrUpdatePlayersInfo(const std::vector<Player>& players) {
	sqlite3_stmt* stmt;

	std::string sql = R"(
		INSERT INTO players_info(tag, clan_tag, name, role, th_level, league_tier, trophies, donations,
							  donations_received, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(tag) DO UPDATE SET
			clan_tag = excluded.clan_tag,
			name = excluded.name,
			role = excluded.role,
			th_level = excluded.th_level,
			league_tier = excluded.league_tier,
			trophies = excluded.trophies,
			donations = excluded.donations,
			donations_received = excluded.donations_received,
			updated_at = excluded.updated_at
	)";

	if (sqlite3_prepare_v2(getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(getDBInstance()) << std::endl;
		return false;
	}

	auto now = std::chrono::system_clock::now();
	auto duration = now.time_since_epoch();

	for (int i = 0; i < players.size(); i++) {
		sqlite3_reset(stmt);

		sqlite3_bind_text(stmt, 1, players[i].tag.c_str(), -1, SQLITE_TRANSIENT);
		sqlite3_bind_text(stmt, 2, players[i].clanTag.c_str(), -1, SQLITE_TRANSIENT);
		sqlite3_bind_text(stmt, 3, players[i].name.c_str(), -1, SQLITE_TRANSIENT);
		sqlite3_bind_text(stmt, 4, players[i].role.c_str(), -1, SQLITE_TRANSIENT);
		sqlite3_bind_int(stmt, 5, players[i].townHallLevel);
		sqlite3_bind_text(stmt, 6, players[i].leagueTier.c_str(), -1, SQLITE_TRANSIENT);
		sqlite3_bind_int(stmt, 7, players[i].trophies);
		sqlite3_bind_int(stmt, 8, players[i].donations);
		sqlite3_bind_int(stmt, 9, players[i].donationsReceived);
		sqlite3_bind_int64(stmt, 10, std::chrono::duration_cast<std::chrono::microseconds>(duration).count());

		if (!executePrepeared(stmt)) return false;
	}

	sqlite3_finalize(stmt);

	return true;
}

bool Database::insertSingleRaidInfo(const CapitalRaid& raid) {
	if (raid.isEmpty()) return 0;

	sqlite3_stmt* stmt;

	std::string sql = R"(
		INSERT INTO raid_info(clan_tag, date, total_loot, raids_completed, total_attacks, enemy_districts_destroyed,
							  offensive_reward, defensive_reward)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	)";

	if (sqlite3_prepare_v2(getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(getDBInstance()) << std::endl;
		return false;
	}

	sqlite3_reset(stmt);

	sqlite3_bind_text(stmt, 1, raid.clanTag.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_text(stmt, 2, raid.date.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_int(stmt, 3, raid.totalLoot);
	sqlite3_bind_int(stmt, 4, raid.raidsCompleted);
	sqlite3_bind_int(stmt, 5, raid.totalAttacks);
	sqlite3_bind_int(stmt, 6, raid.enemyDistrictsDestroyed);
	sqlite3_bind_int(stmt, 7, raid.offensiveReward);
	sqlite3_bind_int(stmt, 8, raid.defensiveReward);

	bool result = executePrepeared(stmt);
	sqlite3_finalize(stmt);

	return result;
}

bool Database::insertSinglePlayersRaidInfo(const std::map<std::string, std::vector<PlayerRaidStats>>& players) {
	if (players.empty()) return 0;

	sqlite3_stmt* stmt;

	std::string sql = R"(
		INSERT INTO players_raid_info(raid_id, player_tag, name, attacks_count, total_loot)
		VALUES (?, ?, ?, ?, ?)
	)";

	if (sqlite3_prepare_v2(getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(getDBInstance()) << std::endl;
		return false;
	}
	
	std::string id = "SELECT id FROM raid_info WHERE date = ?";

	QueryResult res = queryWithParam(id, players.begin()->first);

	for (int i = 0; i < players.begin()->second.size(); i++) {
		sqlite3_reset(stmt);

		sqlite3_bind_int(stmt, 1, std::stoi(res.rows[0][0]));
		sqlite3_bind_text(stmt, 2, players.begin()->second[i].playerTag.c_str(), -1, SQLITE_TRANSIENT);
		sqlite3_bind_text(stmt, 3, players.begin()->second[i].name.c_str(), -1, SQLITE_TRANSIENT);
		sqlite3_bind_int(stmt, 4, players.begin()->second[i].attacksCount);
		sqlite3_bind_int(stmt, 5, players.begin()->second[i].totalLoot);

		if (!executePrepeared(stmt)) return false;
	}

	sqlite3_finalize(stmt);

	return true;
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
			clan_tag TEXT NOT NULL,
			name TEXT NOT NULL,
			role TEXT NOT NULL,
			th_level INTEGER DEFAULT 1,
			league_tier TEXT,
			trophies INTEGER DEFAULT 0,
			donations INTEGER DEFAULT 0,
			donations_received INTEGER DEFAULT 0,
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

	std::string playersRaidsTable = R"(
		CREATE TABLE IF NOT EXISTS players_raid_info(
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