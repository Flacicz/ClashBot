#include "../database/repos/raidRepo.h"

#include "../database/database.h"

#include <iostream>

RaidRepo::RaidRepo(Database* db): db(db) {}

bool RaidRepo::insertOrUpdateSingleRaidInfo(const CapitalRaid& raid) {
	sqlite3_stmt* stmt;

	std::string sql = R"(
		INSERT INTO raid_summary(clan_tag, date, state, total_loot, raids_completed, total_attacks, enemy_districts_destroyed,
							  offensive_reward, defensive_reward)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(clan_tag, date) DO UPDATE SET
            total_loot = excluded.total_loot,
            raids_completed = excluded.raids_completed,
            total_attacks = excluded.total_attacks,
            enemy_districts_destroyed = excluded.enemy_districts_destroyed,
            offensive_reward = excluded.offensive_reward,
            defensive_reward = excluded.defensive_reward
	)";

	if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(db->getDBInstance()) << std::endl;
		return false;
	}

	sqlite3_reset(stmt);

	sqlite3_bind_text(stmt, 1, raid.clanTag.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_text(stmt, 2, raid.date.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_text(stmt, 3, raid.state.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_int(stmt, 4, raid.totalLoot);
	sqlite3_bind_int(stmt, 5, raid.raidsCompleted);
	sqlite3_bind_int(stmt, 6, raid.totalAttacks);
	sqlite3_bind_int(stmt, 7, raid.enemyDistrictsDestroyed);
	sqlite3_bind_int(stmt, 8, raid.offensiveReward);
	sqlite3_bind_int(stmt, 9, raid.defensiveReward);

	bool result = db->executePrepeared(stmt);
	sqlite3_finalize(stmt);

	return result;
}

long long RaidRepo::getRaidIdByDate(const std::string& clanTag, const std::string& date) {
	std::string getRowId = "SELECT id FROM raid_summary WHERE clan_tag = ? AND date = ?";
	sqlite3_stmt* stmt;

	if (sqlite3_prepare_v2(db->getDBInstance(), getRowId.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		return -1;
	}

	sqlite3_bind_text(stmt, 1, clanTag.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_text(stmt, 2, date.c_str(), -1, SQLITE_TRANSIENT);

	long long id = -1;
	if (sqlite3_step(stmt) == SQLITE_ROW) {
		id = sqlite3_column_int64(stmt, 0);
	}

	sqlite3_finalize(stmt);
	return id;
}

long long RaidRepo::getLastRaidId(const std::string& clanTag) {
	std::string getId = "SELECT id FROM raid_summary WHERE clan_tag = ? ORDER BY date DESC LIMIT 1";
	sqlite3_stmt* stmt;

	if (sqlite3_prepare_v2(db->getDBInstance(), getId.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		return -1;
	}

	sqlite3_bind_text(stmt, 1, clanTag.c_str(), -1, SQLITE_TRANSIENT);

	long long id = -1;
	if (sqlite3_step(stmt) == SQLITE_ROW) {
		id = sqlite3_column_int64(stmt, 0);
	}

	sqlite3_finalize(stmt);
	return id;
}

bool RaidRepo::insertOrUpdateSinglePlayersRaidInfo(long long raidId, const std::vector<PlayerRaidStats>& members) {
	sqlite3_stmt* stmt;

	std::string sql = R"(
		INSERT INTO raid_details (
			raid_id, 
			player_tag, 
			name, 
			attacks_count, 
			total_loot
		)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(raid_id, player_tag) DO UPDATE SET
			name = excluded.name,
			attacks_count = excluded.attacks_count,
			total_loot = excluded.total_loot
	)";

	if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(db->getDBInstance()) << std::endl;
		return false;
	}

	for (const auto& m : members) {
		sqlite3_reset(stmt);
		sqlite3_clear_bindings(stmt);

		sqlite3_bind_int64(stmt, 1, raidId);                             
		sqlite3_bind_text(stmt, 2, m.playerTag.c_str(), -1, SQLITE_TRANSIENT); 
		sqlite3_bind_text(stmt, 3, m.name.c_str(), -1, SQLITE_TRANSIENT);      
		sqlite3_bind_int(stmt, 4, m.attacksCount);                       
		sqlite3_bind_int(stmt, 5, m.totalLoot);

		if (sqlite3_step(stmt) != SQLITE_DONE) {
			std::cerr << "Ошибка вставки участника рейда: " << sqlite3_errmsg(db->getDBInstance()) << std::endl;
			sqlite3_finalize(stmt);
			return false;
		}
	}

	sqlite3_finalize(stmt);
	return true;
}

std::vector<PlayerRaidStats> RaidRepo::checkSlackers(long long raidId) {
	sqlite3_stmt* stmt;

	std::string sql = R"(
		SELECT player_tag, name, attacks_count, total_loot FROM raid_details
		WHERE raid_id = ?
		ORDER BY attacks_count ASC
	)";

	std::vector<PlayerRaidStats> slackers;

	if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(db->getDBInstance()) << std::endl;
		return {};
	}

	sqlite3_bind_int64(stmt, 1, raidId);

	while (sqlite3_step(stmt) == SQLITE_ROW) {
		PlayerRaidStats p;
		p.playerTag = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0));
		p.name = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1));
		p.attacksCount = sqlite3_column_int(stmt, 2);
		p.totalLoot = sqlite3_column_int(stmt, 3);
		slackers.push_back(p);
	}

	sqlite3_finalize(stmt);

	return slackers;
}