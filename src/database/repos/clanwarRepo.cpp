#include "../../include/database/repos/clanwarRepo.h"
#include "../../include/database/database.h"

#include <spdlog/spdlog.h>
#include <stdexcept>
#include <vector>
#include <string>

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
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: CWRepo] Failed to prepare Season statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    sqlite3_reset(stmt);
    sqlite3_bind_text(stmt, 1, season.seasonId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, season.clanTag.c_str(), -1, SQLITE_TRANSIENT);

    if (!db->executePrepared(stmt)) {
        sqlite3_finalize(stmt);
        throw std::runtime_error("Failed to execute Season insert/update");
    }

    sqlite3_finalize(stmt);
    return true;
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
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: CWRepo] Failed to prepare Summary statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
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

    if (!db->executePrepared(stmt)) {
        sqlite3_finalize(stmt);
        throw std::runtime_error("Failed to execute Summary insert/update");
    }

    sqlite3_finalize(stmt);
    return true;
}

bool ClanwarRepo::insertSingleClanwarAttacksInfo(const std::string& warId, const std::vector<ClanwarAttack>& attacks) {
    if (attacks.empty()) return true;

    sqlite3_stmt* stmt;

    std::string sql = R"(
        INSERT INTO clanwar_details(
            war_id, attacker_tag, attacker_name, attacker_th, map_position,
            defender_tag, defender_th, stars, destruction, duration,
            order_num, rules, is_opponent_attack
        )
        VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(war_id, attacker_tag, order_num) DO UPDATE SET
            stars = excluded.stars,
            destruction = excluded.destruction,
            duration = excluded.duration,
            rules = excluded.rules
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: CWRepo] Failed to prepare Attacks statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

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
        sqlite3_bind_int(stmt, 13, attack.isOpponentAttack ? 1 : 0);

        if (!db->executePrepared(stmt)) {
            sqlite3_finalize(stmt);
            throw std::runtime_error("Failed to execute Attack insert for tag: " + attack.attackerTag);
        }
    }

    sqlite3_finalize(stmt);
    return true;
}

std::string ClanwarRepo::getLastId(const std::string& clanTag) {
    std::string getId = "SELECT id FROM clanwar_summary WHERE clan_tag = ? ORDER BY prep_start_time DESC LIMIT 1";
    sqlite3_stmt* stmt;

    if (sqlite3_prepare_v2(db->getDBInstance(), getId.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: CWRepo] Failed to prepare getLastId: {}", sqlite3_errmsg(db->getDBInstance()));
        return "";
    }

    sqlite3_bind_text(stmt, 1, clanTag.c_str(), -1, SQLITE_TRANSIENT);

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

std::string ClanwarRepo::getClanwarIdByDate(const std::string& clanTag, const std::string& date) {
    std::string getRowId = "SELECT id FROM clanwar_summary WHERE clan_tag = ? AND prep_start_time = ?";
    sqlite3_stmt* stmt;

    if (sqlite3_prepare_v2(db->getDBInstance(), getRowId.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: CWRepo] Failed to prepare getClanwarIdByDate: {}", sqlite3_errmsg(db->getDBInstance()));
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
        spdlog::error("[DB: CWRepo] Failed to prepare getClanwarAttacks: {}", sqlite3_errmsg(db->getDBInstance()));
        return attacks;
    }

    sqlite3_bind_text(stmt, 1, warId.c_str(), -1, SQLITE_TRANSIENT);

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        ClanwarAttack attack;

        const char* attackerTagText = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0));
        const char* attackerNameText = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1));
        const char* defenderTagText = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 4));
        const char* rulesText = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 10));

        attack.attackerTag = attackerTagText ? attackerTagText : "";
        attack.attackerName = attackerNameText ? attackerNameText : "Unknown";
        attack.attackerTh = sqlite3_column_int(stmt, 2);
        attack.mapPosition = sqlite3_column_int(stmt, 3);
        attack.defenderTag = defenderTagText ? defenderTagText : "";
        attack.defenderTh = sqlite3_column_int(stmt, 5);
        attack.stars = sqlite3_column_int(stmt, 6);
        attack.destruction = sqlite3_column_int(stmt, 7);
        attack.duration = sqlite3_column_int(stmt, 8);
        attack.orderNum = sqlite3_column_int(stmt, 9);
        attack.rules = rulesText ? rulesText : "";
        attack.isOpponentAttack = false;

        attacks.push_back(attack);
    }

    sqlite3_finalize(stmt);
    return attacks;
}