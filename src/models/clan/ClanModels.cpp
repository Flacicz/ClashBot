#include "models/clan/ClanModels.h"

#include <nlohmann/json.hpp>

Clan Clan::fromJson(const nlohmann::json& j)
{
    Clan clan;

    clan.tag = j.value("tag", "unknown");

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

    player.name = j.value("name", "Unknown");

    player.clanTag = clanTag;

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

PlayerSnapshot PlayerSnapshot::parsePlayerSnapshot(const nlohmann::json& j,
                                                   const std::string_view currentClanTag)
{
    PlayerSnapshot playerSnapshot;

    playerSnapshot.playerTag = j.value("tag", "unknown");

    playerSnapshot.clanTag = currentClanTag;

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

std::vector<PlayerSnapshot> PlayerSnapshot::parsePlayerSnapshotList(const nlohmann::json& j,
                                                                     const std::string_view clanTag)
{
    std::vector<PlayerSnapshot> playerSnapshots;
    playerSnapshots.reserve(j["memberList"].size());

    for (const auto& member : j["memberList"])
    {
        playerSnapshots.push_back(parsePlayerSnapshot(member, clanTag));
    }

    return playerSnapshots;
}
