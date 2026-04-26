#include "database/repos/leagueClanwarRepo.h"
#include "database/database.h"
#include "database/sqliteHelpers.h"
#include "models/models.h"

#include <sqlite3.h>
#include <spdlog/spdlog.h>
#include <stdexcept>
#include <string>
#include <vector>

LeagueClanwarRepo::LeagueClanwarRepo(Database* db) : db(db) {};

bool LeagueClanwarRepo::insertOrUpdateSingleCWLSeasonInfo(const ClanwarwarsLeagueSeason& info) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO clanwar_league_seasons(season_id, clan_tag, league, state)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(season_id) DO UPDATE SET
            league = excluded.league,
            state = excluded.state
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: CWLRepo] Failed to prepare Season statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_reset(stmt.get());

    sqlite3_bind_text(stmt.get(), 1, info.seasonId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, info.clanTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 3, info.leagueId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 4, info.state.c_str(), -1, SQLITE_TRANSIENT);

    if (!db->executePrepared(stmt.get())) {
        throw std::runtime_error("Failed to execute CWL Season insert/update");
    }

    return true;
}

bool LeagueClanwarRepo::insertOrUpdateSingleCWLRoundsInfo(const std::vector<ClanwarsLeagueRound>& rounds) const
{
    if (rounds.empty()) return false;

    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO clanwar_league_rounds(war_tag, season_id, round, opponent_tag)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(war_tag) DO UPDATE SET
            season_id = excluded.season_id,
            round = excluded.round,
            opponent_tag = excluded.opponent_tag
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: CWLRepo] Failed to prepare Rounds statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    for (const auto& round : rounds) {
        sqlite3_reset(stmt.get());
        sqlite3_clear_bindings(stmt.get());

        sqlite3_bind_text(stmt.get(), 1, round.warTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 2, round.seasonId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 3, round.round);
        sqlite3_bind_text(stmt.get(), 4, round.opponentTag.c_str(), -1, SQLITE_TRANSIENT);

        if (!db->executePrepared(stmt.get())) {
            throw std::runtime_error("Failed to execute CWL Round insert for tag: " + round.warTag);
        }
    }

    return true;
}

bool LeagueClanwarRepo::insertOrUpdateSingleCWLAttacksInfo(const std::vector<ClanwarsLeagueAttacks>& attacks) const
{
    if (attacks.empty()) return false;

    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO clanwar_league_attacks(
            war_tag, attacker_clan_tag, attacker_tag, attacker_map_position,
            defender_tag, defender_map_position, rules, stars, destruction,
            duration, attacker_th, defender_th
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(war_tag, attacker_tag) DO UPDATE SET
            defender_tag = excluded.defender_tag,
            defender_map_position = excluded.defender_map_position,
            rules = excluded.rules,
            stars = excluded.stars,
            destruction = excluded.destruction,
            duration = excluded.duration,
            attacker_th = excluded.attacker_th,
            defender_th = excluded.defender_th
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: CWLRepo] Failed to prepare Attacks statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    for (const auto& attack : attacks) {
        sqlite3_reset(stmt.get());
        sqlite3_clear_bindings(stmt.get());

        sqlite3_bind_text(stmt.get(), 1, attack.warTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 2, attack.attackerClanTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 3, attack.attackerTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 4, attack.attackerMapPosition);

        sqlite3_bind_text(stmt.get(), 5, attack.defenderTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 6, attack.defenderMapPosition);
        sqlite3_bind_text(stmt.get(), 7, attack.rules.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 8, attack.stars);
        sqlite3_bind_int(stmt.get(), 9, attack.destruction);
        sqlite3_bind_int(stmt.get(), 10, attack.duration);
        sqlite3_bind_int(stmt.get(), 11, attack.attackerTHlvl);
        sqlite3_bind_int(stmt.get(), 12, attack.defenderTHlvl);

        if (!db->executePrepared(stmt.get())) {
            throw std::runtime_error("Failed to execute CWL Attack insert for tag: " + attack.attackerTag);
        }
    }

    return true;
}

bool LeagueClanwarRepo::insertOrUpdateSingleCWLMembersInfo(const std::vector<ClanwarsLeagueMembers>& members) const
{
    if (members.empty()) return false;

    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO clanwar_league_members(
            player_tag, season_id, name, clan_tag
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(player_tag, season_id) DO UPDATE SET
            name = excluded.name,
            clan_tag = excluded.clan_tag
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: CWLRepo] Failed to prepare Members statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    for (const auto& member : members) {
        sqlite3_reset(stmt.get());
        sqlite3_clear_bindings(stmt.get());

        sqlite3_bind_text(stmt.get(), 1, member.playerTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 2, member.seasonId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 3, member.name.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 4, member.clanTag.c_str(), -1, SQLITE_TRANSIENT);

        if (!db->executePrepared(stmt.get())) {
            throw std::runtime_error("Failed to execute CWL Member insert for tag: " + member.playerTag);
        }
    }

    return true;
}

bool LeagueClanwarRepo::isNotified(const std::string& warTag, const std::string& clanTag) const
{
    const std::string sql = "SELECT war_tag FROM clanwar_league_notifications WHERE war_tag = ? AND clan_tag = ?";
    sqlite3_stmt* raw_stmt = nullptr;

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: CWLRepo] Failed to prepare isNotified: {}", sqlite3_errmsg(db->getDBInstance()));
        return false;
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, warTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, clanTag.c_str(), -1, SQLITE_TRANSIENT);

    bool notified = false;
    if (sqlite3_step(stmt.get()) == SQLITE_ROW) {
        notified = true;
    }

    return notified;
}

void LeagueClanwarRepo::markAsNotified(const std::string& warTag, const std::string& clanTag) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO clanwar_league_notifications (
            war_tag, clan_tag
        ) VALUES (?, ?)
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: CWLRepo] Failed to prepare notification insert: {}", sqlite3_errmsg(db->getDBInstance()));
        return;
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, warTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, clanTag.c_str(), -1, SQLITE_TRANSIENT);

    if (!db->executePrepared(stmt.get())) {
        throw std::runtime_error("Failed to execute CWL Notification insert");
    }
}
