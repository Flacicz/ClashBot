#include "models/clanwar/ClanwarModels.h"

#include <nlohmann/json.hpp>
#include <unordered_map>

#include "common/TimeParser.h"

Clanwar Clanwar::fromJson(const nlohmann::json& j, std::string_view warType, std::string_view clanTag)
{
    Clanwar clanwar;

    std::string prepTime = utils::extractTime(j, "preparationStartTime");
    std::string startTime = utils::extractTime(j, "startTime");
    std::string endTime = utils::extractTime(j, "endTime");

    std::string tag1 = j.value("/clan/tag"_json_pointer, "unknown");
    std::string tag2 = j.value("/opponent/tag"_json_pointer, "unknown");
    if (tag1 > tag2) std::swap(tag1, tag2);

    if (!j.contains("attacksPerMember")) clanwar.attacksPerMember = 1; // CWL
    else clanwar.attacksPerMember = j.value("attacksPerMember", 2);

    clanwar.warUID = tag1 + "_" + tag2 + "_" + prepTime;
    clanwar.clanTag = tag1 == clanTag ? tag1 : tag2;
    clanwar.state = j.value("state", "notInWar");
    clanwar.warType = std::string(warType);
    clanwar.teamSize = j.value("teamSize", 0);
    clanwar.preparationStartTime = utils::parseISOToUnix(prepTime);
    clanwar.startTime = utils::parseISOToUnix(startTime);
    clanwar.endTime = utils::parseISOToUnix(endTime);

    if (warType != WarType::CWL)
    {
        clanwar.seasonId = std::nullopt;
        clanwar.roundNumber = std::nullopt;
    }

    return clanwar;
}

ClanwarClan ClanwarClan::fromJson(const nlohmann::json& j, const std::string_view side)
{
    ClanwarClan clanwarClan;
    clanwarClan.side = std::string(side);

    clanwarClan.clanTag = j.value("tag", "unknown");

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
    for (const char* side : {"clan", "opponent"})
    {
        if (!j.contains(side) ||
            !j[side].is_object() ||
            !j[side].contains("members") ||
            !j[side]["members"].is_array()) continue;

        std::string clanTag = j[side].value("tag", "unknown");

        for (const auto& member : j[side]["members"])
        {
            std::string tag = member.value("tag", "unknown");

            int pos = member.value("mapPosition", 0);
            playerInfo[tag] = {clanTag, pos};
        }
    }

    for (const char* side : {"clan", "opponent"})
    {
        if (!j.contains(side) ||
            !j[side].is_object() ||
            !j[side].contains("members") ||
            !j[side]["members"].is_array()) continue;

        std::string attackerClanTag = j[side].value("tag", "unknown");

        for (const auto& member : j[side]["members"])
        {
            std::string attackerTag = member.value("tag", "unknown");
            int attackerPos = member.value("mapPosition", 0);

            if (!member.contains("attacks") || !member["attacks"].is_array()) continue;
            for (const auto& atk : member["attacks"])
            {
                std::string defenderTag = atk.value("defenderTag", "unknown");

                std::string defenderClanTag = "unknown";
                int defenderPos = 0;
                if (auto it = playerInfo.find(defenderTag); it != playerInfo.end())
                {
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

    if (!j.is_object() || !j.contains("members") || !j["members"].is_array()) return membersList;

    std::string clanTag = j.value("tag", "unknown");

    for (const auto& member : j["members"])
    {
        std::string tag = member.value("tag", "unknown");
        std::string name = member.value("name", "Unknown");
        int townhallLevel = member.value("townhallLevel", 0);
        int pos = member.value("mapPosition", 0);

        membersList.emplace_back(clanTag, tag, name, townhallLevel, pos);
    }

    return membersList;
}
