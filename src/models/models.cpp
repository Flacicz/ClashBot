#include "models/models.h"
#include "common/TimeParser.h"
#include "common/StringUtils.h"

#include <nlohmann/json.hpp>
#include <nlohmann/json_fwd.hpp>
#include <string>
#include <unordered_map>
#include <vector>
#include <string_view>

ClanInfo ClanInfo::fromJson(const nlohmann::json& j)
{
    ClanInfo clanInfo;

    clanInfo.tag = j.value("tag", "unknown");
    utils::normalizeTag(clanInfo.tag);

    clanInfo.name = j.value("name", "Unknown");
    clanInfo.type = j.value("type", "unknown");
    clanInfo.description = j.value("description", "");
    clanInfo.members = j.value("members", 0);

    clanInfo.clanLevel = j.value("clanLevel", 0);
    clanInfo.clanPoints = j.value("clanPoints", 0);
    clanInfo.clanBuilderPoints = j.value("clanBuilderBasePoints", 0);
    clanInfo.clanCapitalPoints = j.value("clanCapitalPoints", 0);

    clanInfo.capitalHallLevel = j.value("/clanCapital/capitalHallLevel"_json_pointer, 0);

    clanInfo.capitalLeague = j.value("/capitalLeague/name"_json_pointer, "Unranked");

    clanInfo.requiredTrophies = j.value("requiredTrophies", 0);
    clanInfo.requiredBuilderBaseTrophies = j.value("requiredBuilderBaseTrophies", 0);
    clanInfo.requiredTownhallLevel = j.value("requiredTownhallLevel", 1);

    clanInfo.warFrequency = j.value("warFrequency", "unknown");
    clanInfo.isWarLogPublic = j.value("isWarLogPublic", false);
    clanInfo.warWinStreak = j.value("warWinStreak", 0);
    clanInfo.warWins = j.value("warWins", 0);
    clanInfo.warTies = j.value("warTies", 0);
    clanInfo.warLosses = j.value("warLosses", 0);

    clanInfo.warLeague = j.value("/warLeague/name"_json_pointer, "Unranked");

    clanInfo.locationName = j.value("/location/name"_json_pointer, "Unknown");

    clanInfo.chatLanguage = j.value("/chatLanguage/name"_json_pointer, "Not set");

    return clanInfo;
}

Player Player::fromJson(const nlohmann::json& j, const std::string_view clanTag)
{
    Player player;

    player.tag = j.value("tag", "unknown");
    utils::normalizeTag(player.tag);

    player.clanTag = utils::normalizedTag(clanTag);
    player.name = j.value("name", "Unknown");
    player.role = j.value("role", "member");
    player.townHallLevel = j.value("townHallLevel", 1);
    player.expLevel = j.value("expLevel", 1);

    player.leagueTier = j.value("/league/name"_json_pointer, "Unranked");

    player.trophies = j.value("trophies", 0);
    player.builderBaseTrophies = j.value("builderBaseTrophies", 0);
    player.clanRank = j.value("clanRank", 0);

    player.donations = j.value("donations", 0);
    player.donationsReceived = j.value("donationsReceived", 0);

    return player;
}

PlayerRaidStats PlayerRaidStats::fromJson(const nlohmann::json& j)
{
    PlayerRaidStats player;

    player.playerTag = j.value("tag", "unknown");
    utils::normalizeTag(player.playerTag);

    player.name = j.value("name", "Unknown");
    player.attacksCount = j.value("attacks", 0);
    player.totalLoot = j.value("capitalResourcesLooted", 0);

    return player;
}

CapitalRaid CapitalRaid::fromJson(const nlohmann::json& j, const std::string_view clanTag)
{
    CapitalRaid raid;

    raid.clanTag = utils::normalizedTag(clanTag);

    std::string fullTime = j.value("endTime", "00000000");
    raid.date = fullTime.length() >= 8 ? fullTime.substr(0, 8) : fullTime;
    raid.state = j.value("state", "");

    raid.totalLoot = j.value("capitalTotalLoot", 0);
    raid.raidsCompleted = j.value("raidsCompleted", 0);
    raid.totalAttacks = j.value("totalAttacks", 0);
    raid.enemyDistrictsDestroyed = j.value("enemyDistrictsDestroyed", 0);
    raid.offensiveReward = j.value("offensiveReward", 0);
    raid.defensiveReward = j.value("defensiveReward", 0);

    if (j.contains("members") && j["members"].is_array())
    {
        const auto& membersJson = j["members"];
        raid.members.reserve(membersJson.size());

        for (const auto& m : membersJson)
        {
            raid.members.push_back(PlayerRaidStats::fromJson(m));
        }
    }

    return raid;
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

    const std::string key = side == "home" ? "clan" : "opponent";

    const auto& clanJson = j[key];

    std::string rawTag =


    clanwarClan.clanTag = clanJson.value("tag", "unknown");
    utils::normalizeTag(clanwarClan.clanTag);

    clanwarClan.clanName = clanJson.value("name", "Unknown");
    clanwarClan.clanLevel = clanJson.value("clanLevel", 0);
    clanwarClan.attacksCount = clanJson.value("attacks", 0);
    clanwarClan.stars = clanJson.value("stars", 0);
    clanwarClan.destructionPercentage = clanJson.value("destructionPercentage", 0.0);

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

    for (const char* side : {"clan", "opponent"}) {
        if (!j.contains(side) || !j[side].contains("members")) continue;

        std::string clanTag = j[side].value("tag", "unknown");
        utils::normalizeTag(clanTag);

        for (const auto& member : j[side]["members"]) {
            std::string tag = member.value("tag", "unknown");
            utils::normalizeTag(tag);

            std::string name = member.value("name", "Unknown");
            int townhallLevel = member.value("townhallLevel", 0);
            int pos = member.value("mapPosition", 0);

            membersList.emplace_back(clanTag, tag, name, townhallLevel, pos);
        }

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

