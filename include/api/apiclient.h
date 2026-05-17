#pragma once

#include ".././models/models.h"

#include <string>
#include <vector>

#include <string_view>
#include <nlohmann/json_fwd.hpp>
#include <optional>

class APIClient
{
    std::string apiToken;
    std::string baseUrl;
    std::string tunnelUrl;
    bool isTunnel;

public:
    APIClient(std::string token, bool tunnel, std::string baseUrl, std::string tunnelUrl);
    ~APIClient() = default;

    [[nodiscard]] bool getIsTunnel() const { return isTunnel; }
    [[nodiscard]] const std::string& getApiToken() const { return apiToken; }

    [[nodiscard]] nlohmann::json fetchJson(std::string_view endpoint) const;

    [[nodiscard]] std::optional<CompleteClanData> getCompleteClanData(std::string_view clanTag) const;

    [[nodiscard]] std::optional<CompleteRaidData> getCompleteRaidData(std::string_view clanTag) const;

    [[nodiscard]] std::optional<CompleteClanwarData> getCompleteClanwarData(std::string_view clanTag) const;

    [[nodiscard]] std::optional<CompleteClanwarsLeagueData> getCompleteClanwarsLeagueData(
        std::string_view clanTag) const;
    [[nodiscard]] std::vector<ClanwarsLeagueWarDetails> getLeagueClanwarRoundsInfo(
        const nlohmann::json& parsed, std::string_view clanTag) const;
};
