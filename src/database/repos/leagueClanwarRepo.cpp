#include "../../include/database/repos/leagueClanwarRepo.h"
#include "../../include/database/database.h"
#include "../../include/models/models.h"

#include <sqlite3.h>
#include <spdlog/spdlog.h>
#include <stdexcept>
#include <string>
#include <vector>

LeagueClanwarRepo::LeagueClanwarRepo(Database* db) : db(db) {};

bool LeagueClanwarRepo::insertOrUpdateSingleCWLSeasonInfo(const ClanwarwarsLeagueSeason& info) {
    sqlite3_stmt* stmt;

    std::string sql = R"(
        INSERT INTO clanwar_league_seasons(season_id, clan_tag, league, state)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(season_id) DO UPDATE SET
            league = excluded.league,
            state = excluded.state
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: CWLRepo] Failed to prepare Season statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    sqlite3_reset(stmt);

    sqlite3_bind_text(stmt, 1, info.seasonId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, info.clanTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, info.leagueId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 4, info.state.c_str(), -1, SQLITE_TRANSIENT);

    if (!db->executePrepared(stmt)) {
        sqlite3_finalize(stmt);
        throw std::runtime_error("Failed to execute CWL Season insert/update");
    }

    sqlite3_finalize(stmt);
    return true;
}

bool LeagueClanwarRepo::insertOrUpdateSingleCWLRoundsInfo(const std::vector<ClanwarsLeagueRound>& rounds) {
    if (rounds.empty()) return true;

    sqlite3_stmt* stmt;

    std::string sql = R"(
        INSERT INTO clanwar_league_rounds(war_tag, season_id, round, opponent_tag)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(war_tag) DO UPDATE SET
            season_id = excluded.season_id,
            round = excluded.round,
            opponent_tag = excluded.opponent_tag
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: CWLRepo] Failed to prepare Rounds statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    for (const auto& round : rounds) {
        sqlite3_reset(stmt);
        sqlite3_clear_bindings(stmt);

        sqlite3_bind_text(stmt, 1, round.warTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, round.seasonId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt, 3, round.round);
        sqlite3_bind_text(stmt, 4, round.opponentTag.c_str(), -1, SQLITE_TRANSIENT);

        if (!db->executePrepared(stmt)) {
            sqlite3_finalize(stmt);
            throw std::runtime_error("Failed to execute CWL Round insert for tag: " + round.warTag);
        }
    }

    sqlite3_finalize(stmt);
    return true;
}

bool LeagueClanwarRepo::insertOrUpdateSingleCWLAttacksInfo(const std::vector<ClanwarsLeagueAttacks>& attacks) {
    if (attacks.empty()) return true;

    sqlite3_stmt* stmt;

    std::string sql = R"(
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

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: CWLRepo] Failed to prepare Attacks statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    for (const auto& attack : attacks) {
        sqlite3_reset(stmt);
        sqlite3_clear_bindings(stmt);

        sqlite3_bind_text(stmt, 1, attack.warTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, attack.attackerClanTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 3, attack.attackerTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt, 4, attack.attackerMapPosition);

        sqlite3_bind_text(stmt, 5, attack.defenderTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt, 6, attack.defenderMapPosition);
        sqlite3_bind_text(stmt, 7, attack.rules.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt, 8, attack.stars);
        sqlite3_bind_int(stmt, 9, attack.destruction);
        sqlite3_bind_int(stmt, 10, attack.duration);
        sqlite3_bind_int(stmt, 11, attack.attackerTHlvl);
        sqlite3_bind_int(stmt, 12, attack.defenderTHlvl);

        if (!db->executePrepared(stmt)) {
            sqlite3_finalize(stmt);
            throw std::runtime_error("Failed to execute CWL Attack insert for tag: " + attack.attackerTag);
        }
    }

    sqlite3_finalize(stmt);
    return true;
}

bool LeagueClanwarRepo::insertOrUpdateSingleCWLMembersInfo(const std::vector<ClanwarsLeagueMembers>& members) {
    if (members.empty()) return true;

    sqlite3_stmt* stmt;

    std::string sql = R"(
        INSERT INTO clanwar_league_members(
            player_tag, season_id, name, clan_tag
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(player_tag, season_id) DO UPDATE SET
            name = excluded.name,
            clan_tag = excluded.clan_tag
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: CWLRepo] Failed to prepare Members statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    for (const auto& member : members) {
        sqlite3_reset(stmt);
        sqlite3_clear_bindings(stmt);

        sqlite3_bind_text(stmt, 1, member.playerTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, member.seasonId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 3, member.name.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 4, member.clanTag.c_str(), -1, SQLITE_TRANSIENT);

        if (!db->executePrepared(stmt)) {
            sqlite3_finalize(stmt);
            throw std::runtime_error("Failed to execute CWL Member insert for tag: " + member.playerTag);
        }
    }

    sqlite3_finalize(stmt);
    return true;
}