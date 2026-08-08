#include "database/repos/ClanwarsLeagueRepo.h"

#include <string>
#include <string_view>

#include <fmt/format.h>

#include "database/sqliteHelpers.h"

ClanwarsLeagueRepo::ClanwarsLeagueRepo(sqlite3* db) : BaseRepository(db, std::string(repoName))
{
}

long long ClanwarsLeagueRepo::saveCompleteCWLData(const ClanwarsLeagueSeason& season,
                                                  const std::vector<ClanwarsLeagueMember>& members) const
{
    const long long cwlSeasonId = saveCWLSeason(season);

    saveCWLMembers(cwlSeasonId, members);

    return cwlSeasonId;
}

long long ClanwarsLeagueRepo::saveCWLSeason(const ClanwarsLeagueSeason& season) const
{
    static constexpr std::string_view sql = R"(
        INSERT INTO cwl_seasons(clan_tag, season_id)
        VALUES (?, ?)
        ON CONFLICT(clan_tag, season_id) DO UPDATE SET season_id = excluded.season_id
        RETURNING cwl_season_id;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> long long
    {
        return sqlite::getLong(stmt, 0);
    };

    return queryOne<long long>(
        sql,
        "save clanwars league season",
        fmt::format("clan_tag = {}, season_id = {}", season.clanTag, season.seasonId),
        mapper,
        season.clanTag, season.seasonId
    );
}

void ClanwarsLeagueRepo::saveCWLMembers(long long lastSeasonId,
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

    for (const auto& [playerTag, playerName, townhallLevel, clanTag, seasonId] : members)
    {
        execute(
            sql,
            "save clanwars league member",
            fmt::format("clan_tag = {}, player_tag = {}, season_id = {}, cwl_id = {}",
                        clanTag, playerTag, seasonId, lastSeasonId),
            lastSeasonId, seasonId, clanTag, playerTag, playerName, townhallLevel
        );
    }
}

CWLRoundInfo ClanwarsLeagueRepo::getRoundInfo(long long warId) const
{
    static constexpr std::string_view sql = R"(
        SELECT season_id, round_number
        FROM wars
        WHERE war_id = ?;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> CWLRoundInfo
    {
        return CWLRoundInfo{
            .season = sqlite::getString(stmt, 0),
            .roundNumber = sqlite::getInt(stmt, 1)
        };
    };

    return queryOne<CWLRoundInfo>(
        sql,
        "load clanwars league round info",
        fmt::format("war_id = {}", warId),
        mapper,
        warId
    );
}
