#pragma once

#include <string_view>
#include <vector>

#include <sqlite3.h>

#include "BaseRepository.h"
#include "models/raid/RaidModels.h"


class RaidRepo : public BaseRepository
{
    static constexpr std::string_view repoName = "RaidRepo";

public:
    explicit RaidRepo(sqlite3* db);

    [[nodiscard]] RaidReference saveCompleteRaidData(
        const ClanRaid& clanRaid,
        const std::vector<PlayerRaidSnapshot>& playerRaidSnapshots) const;

    [[nodiscard]] RaidReference saveRaid(const ClanRaid& clanRaid) const;
    void saveRaidPlayerSnapshots(
        const RaidReference& reference,
        const std::vector<PlayerRaidSnapshot>& members) const;

    [[nodiscard]] RaidStats getRaidStats(const RaidReference& reference) const;
    [[nodiscard]] std::vector<RaidMemberStats> getBestRaidMembers(
        const RaidReference& reference) const;
    [[nodiscard]] std::vector<RaidSlacker> getRaidSlackers(
        const RaidReference& reference) const;

    [[nodiscard]] RaidComparisonStats getRaidComparisonStats(
        const RaidReference& reference) const;

    [[nodiscard]] std::vector<RaidReference> getPreviousRaids(
        const RaidReference& currentRaid,
        int limit) const;
};
