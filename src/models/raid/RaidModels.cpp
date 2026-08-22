#include "models/raid/RaidModels.h"

#include <nlohmann/json.hpp>

#include "common/TimeParser.h"

ClanRaid ClanRaid::fromJson(const nlohmann::json& j, const std::string_view clanTag)
{
    ClanRaid clanRaid;

    clanRaid.clanTag = clanTag;

    const std::string startTime = utils::extractTime(j, "startTime");
    const std::string endTime = utils::extractTime(j, "endTime");

    clanRaid.startTime = utils::parseISOToUnix(startTime);
    clanRaid.endTime = utils::parseISOToUnix(endTime);

    clanRaid.state = j.value("state", "");
    clanRaid.totalLoot = j.value("capitalTotalLoot", 0);
    clanRaid.raidsCompleted = j.value("raidsCompleted", 0);
    clanRaid.totalAttacks = j.value("totalAttacks", 0);
    clanRaid.enemyDistrictsDestroyed = j.value("enemyDistrictsDestroyed", 0);
    clanRaid.offensiveReward = j.value("offensiveReward", 0);
    clanRaid.defensiveReward = j.value("defensiveReward", 0);

    return clanRaid;
}

PlayerRaidSnapshot PlayerRaidSnapshot::parsePlayerRaidSnapshot(const nlohmann::json& j)
{
    PlayerRaidSnapshot playerRaidSnapshot;

    playerRaidSnapshot.playerTag = j.value("tag", "unknown");

    playerRaidSnapshot.attacksCount = j.value("attacks", 0);
    playerRaidSnapshot.bonusAttack = j.value("bonusAttackLimit", 0);
    playerRaidSnapshot.totalLoot = j.value("capitalResourcesLooted", 0);

    return playerRaidSnapshot;
}

std::vector<PlayerRaidSnapshot> PlayerRaidSnapshot::fromJson(const nlohmann::json& j)
{
    std::vector<PlayerRaidSnapshot> playerRaidSnapshots;
    playerRaidSnapshots.reserve(j.size());

    for (const auto& member : j)
    {
        playerRaidSnapshots.push_back(parsePlayerRaidSnapshot(member));
    }

    return playerRaidSnapshots;
}
