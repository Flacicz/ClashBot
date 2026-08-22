#pragma once

#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <nlohmann/json_fwd.hpp>

// Core models.
struct Clan
{
    std::string tag;
    std::string name;
    std::string description;
    int locationId;
    std::string locationName;
    int chatLanguageId;
    std::string chatLanguage;
    bool isFamilyFriendly;

    static Clan fromJson(const nlohmann::json& j);
};

struct Player
{
    std::string tag;
    std::string name;
    std::string clanTag;

    static Player parsePlayer(const nlohmann::json& j, std::string_view clanTag);
    static std::vector<Player> parsePlayersList(const nlohmann::json& j);
};

struct ClanSnapshot
{
    std::string clanTag;
    std::string type;
    int membersCount;
    int clanLevel;
    int clanPoints;
    int clanBuilderBasePoints;
    int clanCapitalPoints;
    int capitalHallLevel;
    int capitalLeagueId;
    int requiredTrophies;
    int requiredBuilderBaseTrophies;
    int requiredTownhallLevel;
    std::string warFrequency;
    bool isWarLogPublic;
    int warWinStreak;
    int warWins;
    int warTies;
    int warLosses;
    int warLeagueId;

    static ClanSnapshot fromJson(const nlohmann::json& j);
};

struct PlayerSnapshot
{
    std::string playerTag;
    std::string clanTag;
    std::string role;
    int townHallLevel;
    int expLevel;
    int clanRank;
    int leagueId;
    int builderBaseLeagueId;
    int trophies;
    int builderBaseTrophies;
    int donations;
    int donationsReceived;

    static PlayerSnapshot parsePlayerSnapshot(const nlohmann::json& j, std::string_view currentClanTag);
    static std::vector<PlayerSnapshot> parsePlayerSnapshotList(const nlohmann::json& j, std::string_view clanTag);
};

struct CompleteClanData
{
    Clan clan;
    std::vector<Player> players;
    ClanSnapshot clanSnapshot;
    std::vector<PlayerSnapshot> playerSnapshots;
};

// Synchronization and change models.
struct LatestPlayerState
{
    std::string clanTag;
    std::string playerTag;
    std::string playerName;
    std::string role;
    int townHallLevel;
    int expLevel;
    int clanRank;
    int leagueId;
    int builderBaseLeagueId;
    int trophies;
    int builderBaseTrophies;
    int donations;
    int donationsReceived;
};

struct MembershipChanges
{
    std::vector<Player> leftPlayers;
    std::vector<Player> joinedPlayers;
};

struct RoleChange
{
    std::string clanTag;

    std::string playerTag;
    std::string playerName;

    std::string oldRole;
    std::string newRole;
};

struct RoleChanges
{
    std::vector<RoleChange> changes;
};

// Report models.
struct ClanReportData
{
    std::string clanTag;
    std::pair<std::vector<Player>, std::vector<Player>> leaveJoinPlayers;
};
