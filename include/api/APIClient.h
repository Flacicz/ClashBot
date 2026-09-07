#pragma once

#include <string>

#include "models/clan/ClanModels.h"
#include "models/clanwar/ClanwarModels.h"
#include "models/cwl/CwlModels.h"
#include "models/raid/RaidModels.h"


class APIClient
{
    std::string apiToken;
    std::string baseUrl;
    std::string tunnelUrl;
    bool isTunnel;

    static constexpr std::string_view clientName = "ApiClient";

public:
    APIClient(std::string token, bool tunnel, std::string baseUrl, std::string tunnelUrl);
    virtual ~APIClient() = default;

    [[nodiscard]] bool getIsTunnel() const { return isTunnel; }
    [[nodiscard]] const std::string& getApiToken() const { return apiToken; }

    [[nodiscard]] nlohmann::json fetchJson(std::string_view endpoint) const;

    [[nodiscard]] virtual std::optional<CompleteClanData> getCompleteClanData(
        std::string_view clanTag) const;

    [[nodiscard]] virtual std::optional<CompleteRaidData> getCompleteRaidData(
        std::string_view clanTag) const;

    [[nodiscard]] virtual ClanwarsFetchResult getCompleteClanwarData(
        std::string_view clanTag) const;

    [[nodiscard]] virtual ClanwarsLeagueFetchResult getCompleteClanwarsLeagueData(
        std::string_view clanTag) const;
    [[nodiscard]] std::vector<CompleteClanwarData> getLeagueClanwarRoundsInfo(
        const nlohmann::json& parsed, std::string_view clanTag) const;
};
