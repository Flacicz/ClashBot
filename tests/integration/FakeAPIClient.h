#pragma once

#include "api/APIClient.h"

class FakeAPIClient final : public APIClient
{
public:
    std::optional<CompleteClanData> clanData;
    std::optional<CompleteRaidData> raidData;
    ClanwarsFetchResult clanwarData{
        .status = ClanwarFetchStatus::NoActiveWar,
        .clanwarData = std::nullopt,
        .errorMsg = {}
    };
    ClanwarsLeagueFetchResult clanwarsLeagueData{
        .status = LeagueFetchStatus::NoActiveLeague,
        .completeClanwarsLeagueData = std::nullopt,
        .errorMsg = {}
    };

    FakeAPIClient() : APIClient({}, false, {}, {})
    {
    }

    [[nodiscard]] std::optional<CompleteClanData> getCompleteClanData(
        std::string_view) const override
    {
        return clanData;
    }

    [[nodiscard]] std::optional<CompleteRaidData> getCompleteRaidData(
        std::string_view) const override
    {
        return raidData;
    }

    [[nodiscard]] ClanwarsFetchResult getCompleteClanwarData(
        std::string_view) const override
    {
        return clanwarData;
    }

    [[nodiscard]] ClanwarsLeagueFetchResult getCompleteClanwarsLeagueData(
        std::string_view) const override
    {
        return clanwarsLeagueData;
    }
};
