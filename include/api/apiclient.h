#pragma once

#include <string>

#include "models/models.h"


class APIClient
{
    std::string apiToken;
    std::string baseUrl;
    std::string tunnelUrl;
    bool isTunnel;

    static constexpr std::string_view clientName = "ApiClient";

public:
    APIClient(std::string token, bool tunnel, std::string baseUrl, std::string tunnelUrl);
    ~APIClient() = default;

    [[nodiscard]] bool getIsTunnel() const { return isTunnel; }
    [[nodiscard]] const std::string& getApiToken() const { return apiToken; }

    [[nodiscard]] nlohmann::json fetchJson(std::string_view endpoint) const;

    [[nodiscard]] std::optional<CompleteClanData> getCompleteClanData(std::string_view clanTag) const;

    [[nodiscard]] std::optional<CompleteRaidData> getCompleteRaidData(std::string_view clanTag) const;

    [[nodiscard]] ClanwarsFetchResult getCompleteClanwarData(std::string_view clanTag) const;

    [[nodiscard]] ClanwarsLeagueFetchResult getCompleteClanwarsLeagueData(
        std::string_view clanTag) const;
    [[nodiscard]] std::vector<CompleteClanwarData> getLeagueClanwarRoundsInfo(
        const nlohmann::json& parsed, std::string_view clanTag) const;
};
