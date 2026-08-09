#pragma once

#include <string_view>
#include <vector>

#include <sqlite3.h>

#include "BaseRepository.h"
#include "models/Models.h"


class ClanwarsLeagueRepo : public BaseRepository
{
    static constexpr std::string_view repoName = "ClanwarsLeagueRepo";

public:
    explicit ClanwarsLeagueRepo(sqlite3* db);

    [[nodiscard]] long long saveCompleteCWLData(const ClanwarsLeagueSeason& season,
                                                const std::vector<ClanwarsLeagueMember>& members) const;

    [[nodiscard]] long long saveCWLSeason(const ClanwarsLeagueSeason& season) const;
    void saveCWLMembers(long long lastSeasonId,
                        const std::vector<ClanwarsLeagueMember>& members) const;

    [[nodiscard]] CWLRoundInfo getRoundInfo(long long warId) const;
};
