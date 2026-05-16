#pragma once

#include ".././models/models.h"

#include <string>
#include <vector>

#include <string_view>
#include <nlohmann/json_fwd.hpp>
#include <optional>

class APIClient
{
private:
    std::string apiToken;
    std::string baseUrl;
    std::string tunnelUrl;
    bool isTunnel;

    static std::string normalizeTag(std::string_view tag);
public:
    APIClient(const std::string& token, bool tunnel, const std::string& baseUrl, const std::string& tunnelUrl);
    ~APIClient() = default;

    [[nodiscard]] bool getIsTunnel() const { return isTunnel; }
    [[nodiscard]] const std::string& getApiToken() const { return apiToken; }

    [[nodiscard]] nlohmann::json fetchJson(std::string_view endpoint) const;

    ClanInfo getClanInfo(std::string_view clanTag) const;
    std::vector<Player> getPlayersInfo(std::string_view clanTag) const;

    std::optional<CapitalRaid> getRaidInfo(std::string_view clanTag) const;
    std::vector<PlayerRaidStats> getPlayersRaidInfo(std::string_view clanTag) const;

    [[nodiscard]] std::optional<ClanwarsLeagueSeason> getClanwarsLeagueSeason(std::string_view clanTag) const;
    [[nodiscard]] std::optional<Clanwar> getClanwar(std::string_view clanTag) const;
    [[nodiscard]] std::pair<std::optional<ClanwarClan>, std::optional<ClanwarClan>> getClanwarClan(
        std::string_view clanTag) const;
    [[nodiscard]] std::vector<ClanwarAttack> getClanwarAttacks(std::string_view clanTag) const;
    [[nodiscard]] std::vector<ClanwarMember> getClanwarMembers(std::string_view clanTag) const;
    [[nodiscard]] std::vector<ClanwarsLeagueMember> getClanwarsLeagueMembers(std::string_view clanTag) const;
    [[nodiscard]] std::vector<ClanwarsLeagueWarDetails> getLeagueClanwarRoundsInfo(std::string_view clanTag) const;
};
