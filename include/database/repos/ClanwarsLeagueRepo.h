#pragma once

#include <sqlite3.h>
#include "models/models.h"

class LeagueClanwarRepo
{
    sqlite3* db;
    static constexpr std::string_view repoName = "ClanwarsLeagueRepo";

public:
    explicit LeagueClanwarRepo(sqlite3* db);

    [[nodiscard]] long long insertOrUpdateSingleCWLSeason(const ClanwarsLeagueSeason& season) const;
    [[nodiscard]] bool insertOrUpdateSingleCWLMembers(long long lastSeasonId,
                                                      const std::vector<ClanwarsLeagueMember>& members) const;
    [[nodiscard]] long long saveCompleteCWLData(const ClanwarsLeagueSeason& season,
                                                const std::vector<ClanwarsLeagueMember>& members) const;

    [[nodiscard]] CWLRoundInfo getRoundInfo(long long warId);
};
