#include "database/repos/clanwarRepo.h"
#include "database/database.h"
#include "database/sqliteHelpers.h"

#include <spdlog/spdlog.h>
#include <stdexcept>
#include <vector>
#include <string>

ClanwarRepo::ClanwarRepo(Database* db) : db(db) {}

bool ClanwarRepo::insertSingleClanwarSeasonInfo(const ClanwarSeason& season) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO clanwar_seasons(season_id, clan_tag)
        VALUES (?, ?)
        ON CONFLICT(season_id) DO UPDATE SET
            clan_tag = excluded.clan_tag
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: CWRepo] Failed to prepare Season statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_reset(stmt.get());
    sqlite3_bind_text(stmt.get(), 1, season.seasonId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, season.clanTag.c_str(), -1, SQLITE_TRANSIENT);

    if (!db->executePrepared(stmt.get())) {
        throw std::runtime_error("Failed to execute Season insert/update");
    }

    return true;
}

bool ClanwarRepo::insertSingleClanwarInfo(const Clanwar& clanwar) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO clanwar_summary(season_id, prep_start_time, clan_tag, opponent_tag, opponent_name,
                                  team_size, clan_stars, opp_stars, result)
        VALUES (?, ?, ?, ?, ?, ?, ?, ? , ?)
        ON CONFLICT(prep_start_time, clan_tag) DO UPDATE SET
            clan_stars = excluded.clan_stars,
            opp_stars = excluded.opp_stars,
            result = excluded.result,
            opponent_name = excluded.opponent_name
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: CWRepo] Failed to prepare Summary statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_reset(stmt.get());
    sqlite3_bind_text(stmt.get(), 1, clanwar.seasonId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, clanwar.prepStartTime.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 3, clanwar.clanTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 4, clanwar.opponentTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 5, clanwar.opponentName.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt.get(), 6, clanwar.teamSize);
    sqlite3_bind_int(stmt.get(), 7, clanwar.clanStars);
    sqlite3_bind_int(stmt.get(), 8, clanwar.opponentStars);
    sqlite3_bind_text(stmt.get(), 9, clanwar.result.c_str(), -1, SQLITE_TRANSIENT);

    if (!db->executePrepared(stmt.get())) {
        throw std::runtime_error("Failed to execute Summary insert/update");
    }

    return true;
}

bool ClanwarRepo::insertSingleClanwarAttacksInfo(const std::string& warId, const std::vector<ClanwarAttack>& attacks) const
{
    if (attacks.empty()) return false;

    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
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

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: CWRepo] Failed to prepare Attacks statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    for (const auto& attack : attacks) {
        sqlite3_reset(stmt.get());
        sqlite3_clear_bindings(stmt.get());

        sqlite3_bind_text(stmt.get(), 1, warId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 2, attack.attackerTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 3, attack.attackerName.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 4, attack.attackerTh);
        sqlite3_bind_int(stmt.get(), 5, attack.mapPosition);

        sqlite3_bind_text(stmt.get(), 6, attack.defenderTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 7, attack.defenderTh);
        sqlite3_bind_int(stmt.get(), 8, attack.stars);
        sqlite3_bind_int(stmt.get(), 9, attack.destruction);
        sqlite3_bind_int(stmt.get(), 10, attack.duration);
        sqlite3_bind_int(stmt.get(), 11, attack.orderNum);
        sqlite3_bind_text(stmt.get(), 12, attack.rules.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 13, attack.isOpponentAttack ? 1 : 0);

        if (!db->executePrepared(stmt.get())) {
            throw std::runtime_error("Failed to execute Attack insert for tag: " + attack.attackerTag);
        }
    }

    return true;
}

std::string ClanwarRepo::getLastId(const std::string& clanTag) const
{
    const std::string getId = "SELECT id FROM clanwar_summary WHERE clan_tag = ? ORDER BY prep_start_time DESC LIMIT 1";
    sqlite3_stmt* raw_stmt = nullptr;

    if (sqlite3_prepare_v2(db->getDBInstance(), getId.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: CWRepo] Failed to prepare getLastId: {}", sqlite3_errmsg(db->getDBInstance()));
        return "";
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clanTag.c_str(), -1, SQLITE_TRANSIENT);

    std::string id = "";
    if (sqlite3_step(stmt.get()) == SQLITE_ROW) {
        const unsigned char* text = sqlite3_column_text(stmt.get(), 0);
        if (text) {
            id = reinterpret_cast<const char*>(text);
        }
    }

    return id;
}

std::string ClanwarRepo::getClanwarIdByDate(const std::string& clanTag, const std::string& date) const
{
    const std::string getRowId = "SELECT id FROM clanwar_summary WHERE clan_tag = ? AND prep_start_time = ?";
    sqlite3_stmt* raw_stmt = nullptr;

    if (sqlite3_prepare_v2(db->getDBInstance(), getRowId.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: CWRepo] Failed to prepare getClanwarIdByDate: {}", sqlite3_errmsg(db->getDBInstance()));
        return "";
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clanTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, date.c_str(), -1, SQLITE_TRANSIENT);

    std::string id;
    if (sqlite3_step(stmt.get()) == SQLITE_ROW) {
        const unsigned char* text = sqlite3_column_text(stmt.get(), 0);
        if (text) {
            id = reinterpret_cast<const char*>(text);
        }
    }

    return id;
}

std::vector<ClanwarAttack> ClanwarRepo::getClanwarAttacks(const std::string& warId) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        SELECT attacker_tag, attacker_name, attacker_th, map_position, defender_tag, defender_th, stars,
               destruction, duration, order_num, rules
        FROM clanwar_details WHERE war_id = ? AND is_opponent_attack = 0
    )";

    std::vector<ClanwarAttack> attacks;

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: CWRepo] Failed to prepare getClanwarAttacks: {}", sqlite3_errmsg(db->getDBInstance()));
        return attacks;
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, warId.c_str(), -1, SQLITE_TRANSIENT);

    while (sqlite3_step(stmt.get()) == SQLITE_ROW) {
        ClanwarAttack attack;

        const char* attackerTagText = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 0));
        const char* attackerNameText = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 1));
        const char* defenderTagText = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 4));
        const char* rulesText = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 10));

        attack.attackerTag = attackerTagText ? attackerTagText : "";
        attack.attackerName = attackerNameText ? attackerNameText : "Unknown";
        attack.attackerTh = sqlite3_column_int(stmt.get(), 2);
        attack.mapPosition = sqlite3_column_int(stmt.get(), 3);
        attack.defenderTag = defenderTagText ? defenderTagText : "";
        attack.defenderTh = sqlite3_column_int(stmt.get(), 5);
        attack.stars = sqlite3_column_int(stmt.get(), 6);
        attack.destruction = sqlite3_column_int(stmt.get(), 7);
        attack.duration = sqlite3_column_int(stmt.get(), 8);
        attack.orderNum = sqlite3_column_int(stmt.get(), 9);
        attack.rules = rulesText ? rulesText : "";
        attack.isOpponentAttack = false;

        attacks.push_back(attack);
    }

    return attacks;
}

bool ClanwarRepo::isNotified(const std::string& warId) const
{
    const std::string sql = "SELECT war_id FROM clanwar_notifications WHERE war_id = ?";
    sqlite3_stmt* raw_stmt = nullptr;

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: CWRepo] Failed to prepare isNotified: {}", sqlite3_errmsg(db->getDBInstance()));
        return false;
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, warId.c_str(), -1, SQLITE_TRANSIENT);

    bool notified = false;
    if (sqlite3_step(stmt.get()) == SQLITE_ROW) {
        notified = true;
    }

    return notified;
}

void ClanwarRepo::markAsNotified(const std::string& warId) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO clanwar_notifications (
            war_id
        ) VALUES (?)
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: CWRepo] Failed to prepare notification insert: {}", sqlite3_errmsg(db->getDBInstance()));
        return;
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, warId.c_str(), -1, SQLITE_TRANSIENT);

    if (!db->executePrepared(stmt.get())) {
        throw std::runtime_error("Failed to execute Clanwar Notification insert");
    }
}
