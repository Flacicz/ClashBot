#pragma once

#include <sqlite3.h>
#include "models/models.h"

class LeagueClanwarRepo
{
    sqlite3* db;

public:
    explicit LeagueClanwarRepo(sqlite3* db);

    [[nodiscard]] long long insertOrUpdateSingleCWLSeason(const ClanwarsLeagueSeason& season) const;
    [[nodiscard]] bool insertOrUpdateSingleCWLMembers(long long lastSeasonId,
                                                      const std::vector<ClanwarsLeagueMember>& members) const;
    [[nodiscard]] long long saveCompleteCWLData(const ClanwarsLeagueSeason& season,
                                           const std::vector<ClanwarsLeagueMember>& members) const;
};
