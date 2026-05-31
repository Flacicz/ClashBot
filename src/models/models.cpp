#include "models/models.h"

#include <nlohmann/json.hpp>

#include "common/StringUtils.h"
#include "common/TimeParser.h"

Clan Clan::fromJson(const nlohmann::json& j)
{
    Clan clan;

    clan.tag = j.value("tag", "unknown");
    utils::normalizeTag(clan.tag);

    clan.name = j.value("name", "Unknown");
    clan.description = j.value("description", "");

    clan.locationId = j.value("/location/id"_json_pointer, 0);
    clan.locationName = j.value("/location/name"_json_pointer, "International");

    clan.chatLanguageId = j.value("/chatLanguage/id"_json_pointer, 0);
    clan.chatLanguage = j.value("/chatLanguage/name"_json_pointer, "Not set");

    clan.isFamilyFriendly = j.value("isFamilyFriendly", false);

    return clan;
}

Player Player::parsePlayer(const nlohmann::json& j, const std::string_view clanTag)
{
    Player player;

    player.tag = j.value("tag", "unknown");
    utils::normalizeTag(player.tag);

    player.name = j.value("name", "Unknown");

    player.clanTag = utils::normalizedTag(clanTag);

    return player;
}

std::vector<Player> Player::parsePlayersList(const nlohmann::json& j)
{
    std::vector<Player> players;
    players.reserve(j["memberList"].size());

    const std::string clanTag = j.value("tag", "unknown");

    for (const auto& member : j["memberList"])
    {
        players.push_back(parsePlayer(member, clanTag));
    }

    return players;
}

ClanSnapshot ClanSnapshot::fromJson(const nlohmann::json& j)
{
    ClanSnapshot clanSnapshot;

    clanSnapshot.clanTag = j.value("tag", "unknown");
    utils::normalizeTag(clanSnapshot.clanTag);

    clanSnapshot.type = j.value("type", "open");
    clanSnapshot.membersCount = j.value("members", 0);
    clanSnapshot.clanLevel = j.value("clanLevel", 1);

    clanSnapshot.clanPoints = j.value("clanPoints", 0);
    clanSnapshot.clanBuilderBasePoints = j.value("clanBuilderBasePoints", 0);
    clanSnapshot.clanCapitalPoints = j.value("clanCapitalPoints", 0);

    clanSnapshot.capitalHallLevel = j.value("/clanCapital/capitalHallLevel"_json_pointer, 1);
    clanSnapshot.capitalLeagueId = j.value("/capitalLeague/id"_json_pointer, 0);

    clanSnapshot.requiredTrophies = j.value("requiredTrophies", 0);
    clanSnapshot.requiredBuilderBaseTrophies = j.value("requiredBuilderBaseTrophies", 0);

    clanSnapshot.requiredTownhallLevel = j.value("requiredTownhallLevel", 1);

    clanSnapshot.warFrequency = j.value("warFrequency", "unknown");
    clanSnapshot.isWarLogPublic = j.value("isWarLogPublic", false);
    clanSnapshot.warWinStreak = j.value("warWinStreak", 0);
    clanSnapshot.warWins = j.value("warWins", 0);
    clanSnapshot.warTies = j.value("warTies", 0);
    clanSnapshot.warLosses = j.value("warLosses", 0);

    clanSnapshot.warLeagueId = j.value("/warLeague/id"_json_pointer, 0);

    return clanSnapshot;
}

PlayerSnapshot PlayerSnapshot::parsePlayerSnapshot(const nlohmann::json& j, const std::string_view currentClanTag)
{
    PlayerSnapshot playerSnapshot;

    playerSnapshot.playerTag = j.value("tag", "unknown");
    utils::normalizeTag(playerSnapshot.playerTag);

    playerSnapshot.clanTag = utils::normalizedTag(currentClanTag);

    playerSnapshot.role = j.value("role", "member");
    playerSnapshot.townHallLevel = j.value("townHallLevel", 1);
    playerSnapshot.expLevel = j.value("expLevel", 1);
    playerSnapshot.clanRank = j.value("clanRank", 0);

    playerSnapshot.leagueId = j.value("/league/id"_json_pointer, 0);
    playerSnapshot.builderBaseLeagueId = j.value("/builderBaseLeague/id"_json_pointer, 0);

    playerSnapshot.trophies = j.value("trophies", 0);
    playerSnapshot.builderBaseTrophies = j.value("builderBaseTrophies", 0);
    playerSnapshot.donations = j.value("donations", 0);
    playerSnapshot.donationsReceived = j.value("donationsReceived", 0);

    return playerSnapshot;
}

std::vector<PlayerSnapshot> PlayerSnapshot::parsePlayerSnapshotList(const nlohmann::json& j, std::string_view clanTag)
{
    std::vector<PlayerSnapshot> playerSnapshots;
    playerSnapshots.reserve(j["memberList"].size());

    for (const auto& member : j["memberList"])
    {
        playerSnapshots.push_back(parsePlayerSnapshot(member, clanTag));
    }

    return playerSnapshots;
}

ClanRaid ClanRaid::fromJson(const nlohmann::json& j, const std::string_view clanTag)
{
    ClanRaid clanRaid;

    clanRaid.clanTag = utils::normalizedTag(clanTag);

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
    utils::normalizeTag(playerRaidSnapshot.playerTag);

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

ClanwarsLeagueSeason ClanwarsLeagueSeason::fromJson(const nlohmann::json& j, const std::string_view clanTag)
{
    ClanwarsLeagueSeason season;

    season.clanTag = utils::normalizedTag(clanTag);

    season.seasonId = j.value("season", "0000-00");

    return season;
}

Clanwar Clanwar::fromJson(const nlohmann::json& j, std::string_view warType, std::string_view clanTag)
{
    Clanwar clanwar;

    std::string prepTime = utils::extractTime(j, "preparationStartTime");
    std::string startTime = utils::extractTime(j, "startTime");
    std::string endTime = utils::extractTime(j, "endTime");

    std::string tag1 = j.value("/clan/tag"_json_pointer, "unknown");
    std::string tag2 = j.value("/opponent/tag"_json_pointer, "unknown");
    if (tag1 > tag2) std::swap(tag1, tag2);

    utils::normalizeTag(tag1);
    utils::normalizeTag(tag2);

    clanwar.warUID = tag1 + "_" + tag2 + "_" + prepTime;
    clanwar.clanTag = tag1 == utils::normalizedTag(clanTag) ? tag1 : tag2;
    clanwar.state = j.value("state", "notInWar");
    clanwar.warType = std::string(warType);
    clanwar.teamSize = j.value("teamSize", 0);
    clanwar.attacksPerMember = j.value("attacksPerMember", 2);
    clanwar.preparationStartTime = utils::parseISOToUnix(prepTime);
    clanwar.startTime = utils::parseISOToUnix(startTime);
    clanwar.endTime = utils::parseISOToUnix(endTime);

    if (warType == WarType::CWL) clanwar.seasonId = prepTime.substr(0, 4) + "-" + prepTime.substr(4, 2);
    else clanwar.seasonId = std::nullopt;

    return clanwar;
}

ClanwarClan ClanwarClan::fromJson(const nlohmann::json& j, const std::string_view side)
{
    ClanwarClan clanwarClan;
    clanwarClan.side = std::string(side);

    clanwarClan.clanTag = j.value("tag", "unknown");
    utils::normalizeTag(clanwarClan.clanTag);

    clanwarClan.clanName = j.value("name", "Unknown");
    clanwarClan.clanLevel = j.value("clanLevel", 0);
    clanwarClan.attacksCount = j.value("attacks", 0);
    clanwarClan.stars = j.value("stars", 0);
    clanwarClan.destructionPercentage = j.value("destructionPercentage", 0.0);

    return clanwarClan;
}

std::vector<ClanwarAttack> ClanwarAttack::parseAttacksList(const nlohmann::json& j)
{
    std::vector<ClanwarAttack> attacks;
    if (const std::string state = j.value("state", "notInWar"); state == "notInWar") return attacks;

    std::unordered_map<std::string, std::pair<std::string, int>> playerInfo;
    for (const char* side : {"clan", "opponent"}) {
        if (!j.contains(side) || !j[side].contains("members")) continue;

        std::string clanTag = j[side].value("tag", "unknown");
        utils::normalizeTag(clanTag);

        for (const auto& member : j[side]["members"]) {
            std::string tag = member.value("tag", "unknown");
            utils::normalizeTag(tag);

            int pos = member.value("mapPosition", 0);
            playerInfo[tag] = {clanTag, pos};
        }

    }

    for (const char* side : {"clan", "opponent"}) {
        if (!j.contains(side) || !j[side].contains("members")) continue;

        std::string attackerClanTag = j[side].value("tag", "unknown");
        utils::normalizeTag(attackerClanTag);

        for (const auto& member : j[side]["members"]) {
            std::string attackerTag = member.value("tag", "unknown");
            utils::normalizeTag(attackerTag);

            int attackerPos = member.value("mapPosition", 0);

            if (!member.contains("attacks") || !member["attacks"].is_array()) continue;
            for (const auto& atk : member["attacks"]) {
                std::string defenderTag = atk.value("defenderTag", "unknown");
                utils::normalizeTag(defenderTag);

                std::string defenderClanTag = "unknown";
                int defenderPos = 0;
                if (auto it = playerInfo.find(defenderTag); it != playerInfo.end()) {
                    defenderClanTag = it->second.first;
                    defenderPos = it->second.second;
                }

                attacks.push_back({
                    attackerTag,
                    defenderTag,
                    attackerClanTag,
                    defenderClanTag,
                    attackerPos,
                    defenderPos,
                    atk.value("stars", 0),
                    atk.value("destructionPercentage", 0.0),
                    atk.value("order", 0),
                    atk.value("duration", 0)
                });
            }
        }
    }

    return attacks;
}

std::vector<ClanwarMember> ClanwarMember::parseClanwarMembers(const nlohmann::json& j)
{
    std::vector<ClanwarMember> membersList;

    std::string clanTag = j.value("tag", "unknown");
    utils::normalizeTag(clanTag);

    for (const auto& member : j["members"]) {
        std::string tag = member.value("tag", "unknown");
        utils::normalizeTag(tag);

        std::string name = member.value("name", "Unknown");
        int townhallLevel = member.value("townhallLevel", 0);
        int pos = member.value("mapPosition", 0);

        membersList.emplace_back(clanTag, tag, name, townhallLevel, pos);
    }

    return membersList;
}

std::vector<ClanwarsLeagueMember> ClanwarsLeagueMember::parseClanwarsLeagueMembers(const nlohmann::json& j)
{
    std::vector<ClanwarsLeagueMember> members;
    if (!j.contains("clans") || !j["clans"].is_array()) return members;

    const std::string seasonId = j.value("season", "0000-00");

    for (const auto& clan : j["clans"]) {
        if (!clan.contains("members") || !clan["members"].is_array()) continue;

        std::string clanTag = clan.value("tag", "unknown");
        utils::normalizeTag(clanTag);

        for (const auto& m : clan["members"]) {
            std::string tag = m.value("tag", "");
            utils::normalizeTag(tag);

            members.push_back({
                tag,
                m.value("name", "Unknown"),
                m.value("townHallLevel", 0),
                clanTag,
                seasonId
            });
        }
    }

    return members;
}

