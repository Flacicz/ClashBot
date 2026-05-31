#include "database/repos/leagueClanwarRepo.h"

#include <spdlog/spdlog.h>

#include "database/sqliteHelpers.h"

LeagueClanwarRepo::LeagueClanwarRepo(sqlite3* db) : db(db)
{
}

long long LeagueClanwarRepo::insertOrUpdateSingleCWLSeason(const ClanwarsLeagueSeason& season) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO cwl_seasons(clan_tag, seasons_id)
        VALUES (?, ?)
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClanwarsLeagueRepo] Failed to prepare insertOrUpdateSingleCWLSeason statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, season.clanTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, season.seasonId.c_str(), -1, SQLITE_TRANSIENT);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        spdlog::error("[ClanwarsLeagueRepo] Failed to insert raid {}: {}", season.clanTag, sqlite3_errmsg(db));
        return -1;
    }

    return sqlite3_last_insert_rowid(db);
}

bool LeagueClanwarRepo::insertOrUpdateSingleCWLMembers(const long long lastSeasonId,
                                                      const std::vector<ClanwarsLeagueMember>& members) const
{
    if (members.empty()) return false;

    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO cwl_season_members(
            cwl_season_id, season_id, clan_tag, player_tag, player_name,
            townhall_level
        )
        VALUES (?, ?, ?, ?, ?, ?)
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClanwarsLeagueRepo] Failed to prepare insertOrUpdateSingleCWLMembers statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    for (const auto& [playerTag, playerName, townhallLevel, clanTag, seasonId] : members) {
        sqlite3_bind_int64(stmt.get(), 1, lastSeasonId);
        sqlite3_bind_text(stmt.get(), 2, seasonId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 3, clanTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 4, playerTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 5, playerName.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 6, townhallLevel);

        if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        {
            spdlog::error("[ClanwarsLeagueRepo] Failed to insert raid {}: {}", lastSeasonId, sqlite3_errmsg(db));
            return false;
        }

        sqlite3_reset(stmt.get());
    }

    return true;
}

long long LeagueClanwarRepo::saveCompleteCWLData(const ClanwarsLeagueSeason& season,
                                           const std::vector<ClanwarsLeagueMember>& members) const
{
    const long long lastCWLId = insertOrUpdateSingleCWLSeason(season);
    if (lastCWLId == -1) return -1;

    if (!insertOrUpdateSingleCWLMembers(lastCWLId, members)) return -1;

    return lastCWLId;
}