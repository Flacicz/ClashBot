#pragma once

#include ".././models/models.h"

#include <string>
#include <vector>

#include <string_view>
#include <nlohmann/json_fwd.hpp>
#include <optional>

class APIClient {
private:
	std::string apiToken;
	std::string baseUrl;
	std::string tunnelUrl;
	bool isTunnel;

	static std::string normalizeTag(std::string_view tag);
public:
    nlohmann::json fetchJson(std::string_view endpoint) const;
	APIClient(const std::string& token, bool tunnel, const std::string& baseUrl, const std::string& tunnelUrl);
	~APIClient() = default;

	bool getIsTunnel() const { return isTunnel; };
	const std::string& getApiToken() const { return apiToken; };

	ClanInfo getClanInfo(std::string_view clanTag) const;
	std::vector<Player> getPlayersInfo(std::string_view clanTag) const;

	std::optional<CapitalRaid> getRaidInfo(std::string_view clanTag) const;
	std::vector<PlayerRaidStats> getPlayersRaidInfo(std::string_view clanTag) const;

	std::optional<ClanwarSeason> getClanwarSeason(std::string_view clanTag) const;
	std::optional<ClanWar> getClanwarInfo(std::string_view clanTag) const;
	std::vector<ClanwarAttack> getClanwarAttacks(std::string_view clanTag) const;


	std::optional<ClanwarwarsLeagueSeason> getLeagueClanwarSeasonInfo(std::string_view clanTag) const;
	std::vector<ClanwarsLeagueRound> getLeagueClanwarRoundsInfo(std::string_view clanTag) const;
	std::vector<ClanwarsLeagueAttacks> getLeagueClanwarAttacksInfo(const std::vector<ClanwarsLeagueRound>& rounds) const;
	std::vector<ClanwarsLeagueMembers> getLeagueClanwarMembers(std::string_view clanTag) const;
};
