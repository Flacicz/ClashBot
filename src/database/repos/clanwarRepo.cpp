#include "../database/repos/clanwarRepo.h"

#include "../database/database.h"

#include <vector>
#include <string>
#include <iostream>

ClanwarRepo::ClanwarRepo(Database* db) : db(db) {}

bool ClanwarRepo::insertSingleClanwarSeasonInfo(const ClanwarSeason& season) {
	sqlite3_stmt* stmt;

	std::string sql = R"(
		INSERT INTO clanwar_seasons(season_id, clan_tag)
		VALUES (?, ?)
		ON CONFLICT(season_id) DO UPDATE SET
			clan_tag = excluded.clan_tag
	)";

	if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(db->getDBInstance()) << std::endl;
		return false;
	}

	sqlite3_reset(stmt);

	sqlite3_bind_text(stmt, 1, season.seasonId.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_text(stmt, 2, season.clanTag.c_str(), -1, SQLITE_TRANSIENT);

	bool result = db->executePrepeared(stmt);
	sqlite3_finalize(stmt);

	return result;
}

bool ClanwarRepo::insertSingleClanwarInfo(const ClanWar& clanwar) {
	sqlite3_stmt* stmt;

	std::string sql = R"(
		INSERT INTO clanwar_summary(season_id, prep_start_time, clan_tag, opponent_tag, opponent_name,
										  team_size, clan_stars, opp_stars, result)
		VALUES (?, ?, ?, ?, ?, ?, ?, ? , ?)
		ON CONFLICT(prep_start_time, clan_tag) DO UPDATE SET
			clan_stars = excluded.clan_stars,
			opp_stars = excluded.opp_stars,
			result = excluded.result,
			opponent_name = excluded.opponent_name
	)";

	if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(db->getDBInstance()) << std::endl;
		return false;
	}

	sqlite3_reset(stmt);

	sqlite3_bind_text(stmt, 1, clanwar.seasonId.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_text(stmt, 2, clanwar.prepStartTime.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_text(stmt, 3, clanwar.clanTag.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_text(stmt, 4, clanwar.opponentTag.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_text(stmt, 5, clanwar.opponentName.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_int(stmt, 6, clanwar.teamSize);
	sqlite3_bind_int(stmt, 7, clanwar.clanStars);
	sqlite3_bind_int(stmt, 8, clanwar.opponentStars);
	sqlite3_bind_text(stmt, 9, clanwar.result.c_str(), -1, SQLITE_TRANSIENT);

	bool result = db->executePrepeared(stmt);
	sqlite3_finalize(stmt);

	return result;
}

bool ClanwarRepo::insertSingleClanwarAttacksInfo(std::string warId, std::vector<ClanwarAttack> attacks) {
	sqlite3_stmt* stmt;

	std::string sql = R"(
		INSERT INTO clanwar_details(
			war_id,
			attacker_tag,
			attacker_name,
			attacker_th,
			map_position,
			defender_tag,
			defender_th,
			stars,
			destruction,
			duration,
			order_num,
			rules,
			is_opponent_attack
    )
    VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(war_id, attacker_tag, order_num) DO UPDATE SET
        stars = excluded.stars,
        destruction = excluded.destruction,
        duration = excluded.duration,
        rules = excluded.rules;
	)";

	if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(db->getDBInstance()) << std::endl;
		return false;
	}

	db->execute("BEGIN TRANSACTION;");

	for (const auto& attack : attacks) {
		sqlite3_reset(stmt);
		sqlite3_clear_bindings(stmt);

		sqlite3_bind_text(stmt, 1, warId.c_str(), -1, SQLITE_TRANSIENT);
		sqlite3_bind_text(stmt, 2, attack.attackerTag.c_str(), -1, SQLITE_TRANSIENT);
		sqlite3_bind_text(stmt, 3, attack.attackerName.c_str(), -1, SQLITE_TRANSIENT);
		sqlite3_bind_int(stmt, 4, attack.attackerTh);
		sqlite3_bind_int(stmt, 5, attack.mapPosition);
		sqlite3_bind_text(stmt, 6, attack.defenderTag.c_str(), -1, SQLITE_TRANSIENT);
		sqlite3_bind_int(stmt, 7, attack.defenderTh);
		sqlite3_bind_int(stmt, 8, attack.stars);
		sqlite3_bind_int(stmt, 9, attack.destruction);
		sqlite3_bind_int(stmt, 10, attack.duration);
		sqlite3_bind_int(stmt, 11, attack.orderNum);
		sqlite3_bind_text(stmt, 12, attack.rules.c_str(), -1, SQLITE_TRANSIENT);
		sqlite3_bind_int(stmt, 13, attack.isOpponentAttack);

		if (!db->executePrepeared(stmt)) {
			db->execute("ROLLBACK;");
			sqlite3_finalize(stmt);
			return false;
		}
	}

	db->execute("COMMIT;");

	sqlite3_finalize(stmt);

	return true;
}

std::string ClanwarRepo::getLastId(const std::string& clanTag) {
	std::string getId = "SELECT id FROM clanwar_summary WHERE clan_tag = ? ORDER BY prep_start_time DESC LIMIT 1";
	sqlite3_stmt* stmt;

	if (sqlite3_prepare_v2(db->getDBInstance(), getId.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(db->getDBInstance()) << std::endl;
		return "";
	}

	sqlite3_bind_text(stmt, 1, clanTag.c_str(), -1, SQLITE_TRANSIENT);

	std::string id = "";
	if (sqlite3_step(stmt) == SQLITE_ROW) {
		id = (const char *)sqlite3_column_text(stmt, 0);
	}

	sqlite3_finalize(stmt);
	return id;
}

std::string ClanwarRepo::getClanwarIdByDate(const std::string& clanTag, const std::string& date) {
	std::string getRowId = "SELECT id FROM clanwar_summary WHERE clan_tag = ? AND prep_start_time = ?";
	sqlite3_stmt* stmt;

	if (sqlite3_prepare_v2(db->getDBInstance(), getRowId.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		return "";
	}

	sqlite3_bind_text(stmt, 1, clanTag.c_str(), -1, SQLITE_TRANSIENT);
	sqlite3_bind_text(stmt, 2, date.c_str(), -1, SQLITE_TRANSIENT);

	std::string id = "";
	if (sqlite3_step(stmt) == SQLITE_ROW) {
		const unsigned char* text = sqlite3_column_text(stmt, 0);
		if (text) {
			id = reinterpret_cast<const char*>(text);
		}
	}

	sqlite3_finalize(stmt);
	return id;
}

std::vector<ClanwarAttack> ClanwarRepo::getClanwarAttacks(const std::string& warId) {
	sqlite3_stmt* stmt;

	std::string sql = R"(
		SELECT attacker_tag, attacker_name, attacker_th, map_position, defender_tag, defender_th, stars,
			   destruction, duration, order_num, rules
		FROM clanwar_details WHERE war_id = ? AND is_opponent_attack = 0
	)";

	std::vector<ClanwarAttack> attacks;

	if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(db->getDBInstance()) << std::endl;
		return {};
	}

	sqlite3_bind_text(stmt, 1, warId.c_str(), -1, SQLITE_TRANSIENT);

	while (sqlite3_step(stmt) == SQLITE_ROW) {
		ClanwarAttack attack;

		attack.attackerTag = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0));
		attack.attackerName = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1));
		attack.attackerTh = (sqlite3_column_int(stmt, 2));
		attack.mapPosition = (sqlite3_column_int(stmt, 3));
		attack.defenderTag = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 4));
		attack.defenderTh = (sqlite3_column_int(stmt, 5));
		attack.stars = (sqlite3_column_int(stmt, 6));
		attack.destruction = (sqlite3_column_int(stmt, 7));
		attack.duration = (sqlite3_column_int(stmt, 8));
		attack.orderNum = (sqlite3_column_int(stmt, 9));
		attack.rules = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 10));
		attack.isOpponentAttack = false;


		attacks.push_back(attack);
	}

	sqlite3_finalize(stmt);

	return attacks;
}