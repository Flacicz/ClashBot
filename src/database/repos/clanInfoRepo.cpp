#include "../../include/database/repos/clanInfoRepo.h"

#include "../database/database.h"

#include <iostream>
#include <chrono>

ClanInfoRepo::ClanInfoRepo(Database* db) : db(db) {}

bool ClanInfoRepo::insertOrUpdateClanInfo(const ClanInfo& clanInfo) {
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

	if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(db->getDBInstance()) << std::endl;
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

	bool result = db->executePrepeared(stmt);
	sqlite3_finalize(stmt);

	return result;
}

bool ClanInfoRepo::insertOrUpdatePlayersInfo(const std::vector<Player>& players) {
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

	if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(db->getDBInstance()) << std::endl;
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

		if (!db->executePrepeared(stmt)) return false;
	}

	sqlite3_finalize(stmt);

	return true;
}