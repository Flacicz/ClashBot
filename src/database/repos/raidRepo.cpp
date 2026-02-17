#include "../database/repos/raidRepo.h"

#include "../database/database.h"

#include <iostream>

RaidRepo::RaidRepo(Database* db): db(db) {}

bool RaidRepo::insertSingleRaidInfo(const CapitalRaid& raid) {
	if (raid.isEmpty()) return 0;

	sqlite3_stmt* stmt;

	std::string sql = R"(
		INSERT INTO raid_summary(clan_tag, date, total_loot, raids_completed, total_attacks, enemy_districts_destroyed,
							  offensive_reward, defensive_reward)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	)";

	if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(db->getDBInstance()) << std::endl;
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

	bool result = db->executePrepeared(stmt);
	sqlite3_finalize(stmt);

	return result;
}

bool RaidRepo::insertSinglePlayersRaidInfo(const std::map<std::string, std::vector<PlayerRaidStats>>& players) {
	if (players.empty()) return 0;

	sqlite3_stmt* stmt;

	std::string sql = R"(
		INSERT INTO raid_deatils(raid_id, player_tag, name, attacks_count, total_loot)
		VALUES (?, ?, ?, ?, ?)
	)";

	if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(db->getDBInstance()) << std::endl;
		return false;
	}

	std::string id = "SELECT id FROM raid_info WHERE date = ?";

	Database::QueryResult res = db->queryWithParam(id, players.begin()->first);

	for (int i = 0; i < players.begin()->second.size(); i++) {
		sqlite3_reset(stmt);

		sqlite3_bind_int(stmt, 1, std::stoi(res.rows[0][0]));
		sqlite3_bind_text(stmt, 2, players.begin()->second[i].playerTag.c_str(), -1, SQLITE_TRANSIENT);
		sqlite3_bind_text(stmt, 3, players.begin()->second[i].name.c_str(), -1, SQLITE_TRANSIENT);
		sqlite3_bind_int(stmt, 4, players.begin()->second[i].attacksCount);
		sqlite3_bind_int(stmt, 5, players.begin()->second[i].totalLoot);

		if (!db->executePrepeared(stmt)) return false;
	}

	sqlite3_finalize(stmt);

	return true;
}