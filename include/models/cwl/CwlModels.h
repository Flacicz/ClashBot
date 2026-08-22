#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <nlohmann/json_fwd.hpp>

#include "models/clanwar/ClanwarModels.h"

// Core models.
struct ClanwarsLeagueSeason
{
    std::string clanTag;
    std::string seasonId;

    static ClanwarsLeagueSeason fromJson(const nlohmann::json& j, std::string_view clanTag);
};

struct ClanwarsLeagueMember
{
    std::string playerTag;
    std::string playerName;
    int townhallLevel;
    std::string clanTag;
    std::string seasonId;

    static std::vector<ClanwarsLeagueMember> parseClanwarsLeagueMembers(const nlohmann::json& j);
};

struct CompleteClanwarsLeagueData
{
    ClanwarsLeagueSeason clanwarsLeagueSeason;
    std::vector<ClanwarsLeagueMember> clanwarsLeagueMembers;
    std::vector<CompleteClanwarData> warDetails;
};

// Fetch-result models.
enum class LeagueFetchStatus
{
    Success,
    NoActiveLeague,
    Error
};

struct ClanwarsLeagueFetchResult
{
    LeagueFetchStatus status;
    std::optional<CompleteClanwarsLeagueData> completeClanwarsLeagueData;
    std::string errorMsg;
};

struct CWLRoundInfo
{
    std::string season;
    int roundNumber;
};

// Report models.
struct ClanwarsLeagueRoundReportData
{
    CWLRoundInfo cwlRoundInfo;
    WarRoundDetails warDetails;
};
