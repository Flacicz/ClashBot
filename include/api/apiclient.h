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
	nlohmann::json fetchJson(const std::string& endpoint) const;
public:
	APIClient(const std::string& token, bool tunnel, const std::string& baseUrl, const std::string& tunnelUrl);
	~APIClient();

	const bool getIsTunnel() const { return isTunnel; };
	const std::string getApiToken() const { return apiToken; };

	ClanInfo getClanInfo(std::string_view clanTag) const;
	std::vector<Player> getPlayersInfo(std::string_view clanTag) const;

	std::optional<CapitalRaid> getRaidInfo(std::string_view clanTag) const;
	std::vector<PlayerRaidStats> getPlayersRaidInfo(std::string_view clanTag) const;

	std::optional<ClanwarSeason> getClanwarSeason(std::string_view clanTag) const;
	std::optional<ClanWar> getClanwarInfo(std::string_view clanTag) const;
	std::vector<ClanwarAttack> getClanwarAttacks(std::string_view clanTag) const;


	LeagueClanwarSeason getLeagueClanwarSeasonInfo(std::string_view clanTag) const;
	std::vector<LeagueClanwarRound> getLeagueClanwarRoundsInfo(std::string_view clanTag) const;
	std::vector<LeagueClanwarAttack> getLeagueClanwarAttacksInfo(std::string_view clanTag, const std::vector<LeagueClanwarRound>& rounds) const;
	std::vector<LeagueClanwarMember> getLeagueClanwarMembers(std::string_view clanTag) const;
};
