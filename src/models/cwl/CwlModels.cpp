#include "models/cwl/CwlModels.h"

#include <nlohmann/json.hpp>

ClanwarsLeagueSeason ClanwarsLeagueSeason::fromJson(const nlohmann::json& j, const std::string_view clanTag)
{
    ClanwarsLeagueSeason season;

    season.seasonId = j.value("season", "0000-00");
    season.clanTag = clanTag;

    return season;
}

std::vector<ClanwarsLeagueMember> ClanwarsLeagueMember::parseClanwarsLeagueMembers(const nlohmann::json& j)
{
    std::vector<ClanwarsLeagueMember> members;
    if (!j.contains("clans") || !j["clans"].is_array()) return members;

    const std::string seasonId = j.value("season", "0000-00");

    for (const auto& clan : j["clans"])
    {
        if (!clan.contains("members") || !clan["members"].is_array()) continue;

        const std::string clanTag = clan.value("tag", "unknown");

        for (const auto& m : clan["members"])
        {
            const std::string tag = m.value("tag", "");

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
