#pragma once

#include "models/models.h"
#include <sqlite3.h>

class RaidRepo
{
    sqlite3* db;
    static constexpr std::string_view repoName = "RaidRepo";

public:
    explicit RaidRepo(sqlite3* db);

    [[nodiscard]] long long saveRaid(const ClanRaid& clanRaid) const;
    void saveRaidPlayerSnapshots(long long raidId,
                                            const std::vector<PlayerRaidSnapshot>& members) const;
    [[nodiscard]] long long saveCompleteRaidData(const ClanRaid& clanRaid,
                                                 const std::vector<PlayerRaidSnapshot>& playerRaidSnapshots) const;

    [[nodiscard]] std::vector<RaidSlacker> getRaidSlackers(long long raidId, std::string_view clanTag) const;
};
