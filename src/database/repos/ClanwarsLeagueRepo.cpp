#include "database/repos/ClanwarsLeagueRepo.h"

#include "core/Exceptions.h"
#include "database/sqliteHelpers.h"
#include "spdlog/fmt/bundled/format.h"

ClanwarsLeagueRepo::ClanwarsLeagueRepo(sqlite3* db) : db(db)
{
}

long long ClanwarsLeagueRepo::saveCWLSeason(const ClanwarsLeagueSeason& season) const
{
    static constexpr std::string_view sql = R"(
        INSERT INTO cwl_seasons(clan_tag, season_id)
        VALUES (?, ?)
        ON CONFLICT(clan_tag, season_id) DO UPDATE SET season_id = excluded.season_id
        RETURNING cwl_season_id;
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, season.clanTag);
    sqlite::bind(stmt.get(), 2, season.seasonId);

    if (sqlite3_step(stmt.get()) != SQLITE_ROW)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to save clanwars league season (clan_tag = {}, season_id = {}): {}",
                repoName, season.clanTag,
                season.seasonId,
                sqlite3_errmsg(db)));
    }

    return sqlite::getLong(stmt.get(), 0);
}

void ClanwarsLeagueRepo::saveCWLMembers(const long long lastSeasonId,
                                        const std::vector<ClanwarsLeagueMember>& members) const
{
    if (members.empty()) return;

    static constexpr std::string_view sql = R"(
        INSERT OR IGNORE INTO cwl_season_members(
            cwl_season_id, season_id, clan_tag, player_tag, player_name,
            townhall_level
        )
        VALUES (?, ?, ?, ?, ?, ?)
    )";

    const auto stmt = sqlite::prepare(db, sql);

    for (const auto& [playerTag, playerName, townhallLevel, clanTag, seasonId] : members)
    {
        sqlite::bind(stmt.get(), 1, lastSeasonId);
        sqlite::bind(stmt.get(), 2, seasonId);
        sqlite::bind(stmt.get(), 3, clanTag);
        sqlite::bind(stmt.get(), 4, playerTag);
        sqlite::bind(stmt.get(), 5, playerName);
        sqlite::bind(stmt.get(), 6, townhallLevel);

        if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        {
            throw DatabaseException(
                fmt::format(
                    "[{}] Failed to save clanwars league member (clan_tag = {}, player_tag = {}, season_id = {}, cwl_id = {}): {}",
                    repoName, clanTag, playerTag,
                    seasonId, lastSeasonId,
                    sqlite3_errmsg(db)));
        }

        sqlite3_reset(stmt.get());
        sqlite3_clear_bindings(stmt.get());
    }
}

long long ClanwarsLeagueRepo::saveCompleteCWLData(const ClanwarsLeagueSeason& season,
                                                  const std::vector<ClanwarsLeagueMember>& members) const
{
    const long long cwlSeasonId = saveCWLSeason(season);

    saveCWLMembers(cwlSeasonId, members);

    return cwlSeasonId;
}

CWLRoundInfo ClanwarsLeagueRepo::getRoundInfo(const long long warId) const
{
    static constexpr std::string_view sql = R"(
        SELECT season_id, round_number
        FROM wars
        WHERE war_id = ?;
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, warId);

    if (sqlite3_step(stmt.get()) != SQLITE_ROW)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to load clanwars league round info (war_id = {}): {}",
                repoName, warId,
                sqlite3_errmsg(db)));
    }

    return CWLRoundInfo{
        .season = sqlite::getString(stmt.get(), 0),
        .roundNumber = sqlite::getInt(stmt.get(), 1)
    };
}
