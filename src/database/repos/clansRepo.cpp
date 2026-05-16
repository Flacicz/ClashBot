#include "database/repos/clansRepo.h"
#include "models/models.h"
#include "database/database.h"
#include "database/sqliteHelpers.h"

#include <sqlite3.h>
#include <spdlog/spdlog.h>
#include <stdexcept>
#include <string>
#include <vector>

ClansRepo::ClansRepo(Database* db) : db(db) {}

bool ClansRepo::insertOrUpdateClanInfo(const ClanInfo& clanInfo) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
    INSERT INTO clans (
        tag, name, type, description, members, 
        clan_level, clan_points, clan_builder_points, clan_capital_points, 
        capital_hall_level, capital_league, required_trophies, 
        required_builder_base_trophies, required_town_hall_level, 
        war_frequency, is_war_log_public, war_win_streak, war_wins, 
        war_ties, war_losses, war_league, location_name, chat_language
    ) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tag) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        description = excluded.description,
        members = excluded.members,
        clan_level = excluded.clan_level,
        clan_points = excluded.clan_points,
        clan_builder_points = excluded.clan_builder_points,
        clan_capital_points = excluded.clan_capital_points,
        capital_hall_level = excluded.capital_hall_level,
        capital_league = excluded.capital_league,
        required_trophies = excluded.required_trophies,
        required_builder_base_trophies = excluded.required_builder_base_trophies,
        required_town_hall_level = excluded.required_town_hall_level,
        war_frequency = excluded.war_frequency,
        is_war_log_public = excluded.is_war_log_public,
        war_win_streak = excluded.war_win_streak,
        war_wins = excluded.war_wins,
        war_ties = excluded.war_ties,
        war_losses = excluded.war_losses,
        war_league = excluded.war_league,
        location_name = excluded.location_name,
        chat_language = excluded.chat_language,
        updated_at = strftime('%s', 'now')
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: Repo] Failed to prepare ClanInfo statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clanInfo.tag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, clanInfo.name.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 3, clanInfo.type.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 4, clanInfo.description.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt.get(), 5, clanInfo.members);

    sqlite3_bind_int(stmt.get(), 6, clanInfo.clanLevel);
    sqlite3_bind_int(stmt.get(), 7, clanInfo.clanPoints);
    sqlite3_bind_int(stmt.get(), 8, clanInfo.clanBuilderPoints);
    sqlite3_bind_int(stmt.get(), 9, clanInfo.clanCapitalPoints);
    sqlite3_bind_int(stmt.get(), 10, clanInfo.capitalHallLevel);
    sqlite3_bind_text(stmt.get(), 11, clanInfo.capitalLeague.c_str(), -1, SQLITE_TRANSIENT);

    sqlite3_bind_int(stmt.get(), 12, clanInfo.requiredTrophies);
    sqlite3_bind_int(stmt.get(), 13, clanInfo.requiredBuilderBaseTrophies);
    sqlite3_bind_int(stmt.get(), 14, clanInfo.requiredTownhallLevel);

    sqlite3_bind_text(stmt.get(), 15, clanInfo.warFrequency.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt.get(), 16, clanInfo.isWarLogPublic ? 1 : 0);
    sqlite3_bind_int(stmt.get(), 17, clanInfo.warWinStreak);
    sqlite3_bind_int(stmt.get(), 18, clanInfo.warWins);
    sqlite3_bind_int(stmt.get(), 19, clanInfo.warTies);
    sqlite3_bind_int(stmt.get(), 20, clanInfo.warLosses);
    sqlite3_bind_text(stmt.get(), 21, clanInfo.warLeague.c_str(), -1, SQLITE_TRANSIENT);

    sqlite3_bind_text(stmt.get(), 22, clanInfo.locationName.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 23, clanInfo.chatLanguage.c_str(), -1, SQLITE_TRANSIENT);

    if (!db->executePrepared(stmt.get())) {
        throw std::runtime_error("Failed to execute ClanInfo insert/update");
    }

    return true;
}

bool ClansRepo::insertOrUpdatePlayersInfo(const std::vector<Player>& players) const
{
    if (players.empty()) return false;

    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO players_info (
            tag, clan_tag, name, role, th_level, exp_level, 
            league_tier, trophies, builder_base_trophies, 
            donations, donations_received, clan_rank, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
        ON CONFLICT(tag) DO UPDATE SET
            clan_tag = excluded.clan_tag,
            name = excluded.name,
            role = excluded.role,
            th_level = excluded.th_level,
            exp_level = excluded.exp_level,
            league_tier = excluded.league_tier,
            trophies = excluded.trophies,
            builder_base_trophies = excluded.builder_base_trophies,
            donations = excluded.donations,
            donations_received = excluded.donations_received,
            clan_rank = excluded.clan_rank,
            updated_at = strftime('%s', 'now')
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: Repo] Failed to prepare PlayersInfo statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    for (const auto& player : players) {
        sqlite3_reset(stmt.get());
        sqlite3_clear_bindings(stmt.get());

        sqlite3_bind_text(stmt.get(), 1, player.tag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 2, player.clanTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 3, player.name.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 4, player.role.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 5, player.townHallLevel);
        sqlite3_bind_int(stmt.get(), 6, player.expLevel);
        sqlite3_bind_text(stmt.get(), 7, player.leagueTier.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 8, player.trophies);
        sqlite3_bind_int(stmt.get(), 9, player.builderBaseTrophies);
        sqlite3_bind_int(stmt.get(), 10, player.donations);
        sqlite3_bind_int(stmt.get(), 11, player.donationsReceived);
        sqlite3_bind_int(stmt.get(), 12, player.clanRank);

        if (!db->executePrepared(stmt.get())) {
            throw std::runtime_error("Failed to execute PlayersInfo insert for tag: " + player.tag);
        }
    }

    return true;
}

bool ClansRepo::removeExitedPlayers(const std::string& clanTag, const long long updated_time) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = "DELETE FROM players_info WHERE clan_tag = ? AND updated_at < ?";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: Repo] Failed to prepare removeExitedPlayers statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clanTag.c_str(), -1, SQLITE_TRANSIENT);

    sqlite3_bind_int64(stmt.get(), 2, updated_time - 5);

    if (!db->executePrepared(stmt.get())) {
        throw std::runtime_error("Failed to execute removeExitedPlayers");
    }

    return true;
}