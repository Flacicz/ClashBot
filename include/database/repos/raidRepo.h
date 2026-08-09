#pragma once

#include <string_view>
#include <vector>

#include <sqlite3.h>

#include "BaseRepository.h"
#include "models/Models.h"


class RaidRepo : public BaseRepository
{
    static constexpr std::string_view repoName = "RaidRepo";

public:
    explicit RaidRepo(sqlite3* db);

    [[nodiscard]] long long saveCompleteRaidData(const ClanRaid& clanRaid,
                                                 const std::vector<PlayerRaidSnapshot>& playerRaidSnapshots) const;

    [[nodiscard]] long long saveRaid(const ClanRaid& clanRaid) const;
    void saveRaidPlayerSnapshots(long long raidId,
                                 const std::vector<PlayerRaidSnapshot>& members) const;

    [[nodiscard]] RaidStats getRaidStats(long long raidId) const;
    [[nodiscard]] std::vector<RaidMemberStats> getBestRaidMembers(long long raidId) const;
    [[nodiscard]] std::vector<RaidSlacker> getRaidSlackers(long long raidId, std::string_view clanTag) const;
};
