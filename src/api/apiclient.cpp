#include "../api/apiclient.h"
#include "../models/models.h"

#include <cpr/cpr.h>
#include <nlohmann/json.hpp>
#include <iostream>
#include <vector>

using json = nlohmann::json;

APIClient::APIClient(const std::string& clanTag, bool tunnel) : clanTag(clanTag), isTunnel(tunnel) {}

APIClient::~APIClient() {}

auto APIClient::getResponse(const std::string& urlPart) const {
	std::string url = (getIsTunnel() ? tunnelUrl : baseUrl) + urlPart;

	cpr::Response response = cpr::Get(
		cpr::Url{ url },
		cpr::Header{
			{"Authorization", "Bearer " + getApiToken()},
			{"Accept", "Application/json"},
		},
		cpr::VerifySsl(!getIsTunnel()),
		cpr::Timeout(10000)
	);

	if (response.status_code != 200) std::cerr << "Не удалось выполнить запрос, код ошибки: " << response.status_code << std::endl;
	else std::cout << response.status_code << std::endl;

	return response;
}

ClanInfo APIClient::getClanInfo() const {
	std::string url = "/clans/%23" + getClanTag().substr(1, getClanTag().length() - 1);
	auto response = getResponse(url);

	json parsed = json::parse(response.text);

	ClanInfo clanInfo = {
		parsed["tag"],
		parsed["name"],
		parsed["members"],
		parsed["clanLevel"],
		parsed["clanCapital"]["capitalHallLevel"],
		parsed["capitalLeague"]["name"],
		parsed["warLeague"]["name"],
		parsed["warWinStreak"],
		parsed["warWins"],
		parsed["warTies"],
		parsed["warLosses"]
	};

	return clanInfo;
}

std::vector<Player> APIClient::getPlayersInfo() const {
	std::string url = "/clans/%23" + getClanTag().substr(1, getClanTag().length() - 1) + "/members";
	auto response = getResponse(url);

	json parsed = json::parse(response.text);

	std::vector<Player> players;
	for (const auto& part : parsed["items"]) {
		Player player = {
			part["tag"],
			getClanTag(),
			part["name"],
			part["role"],
			part["townHallLevel"],
			part["leagueTier"]["name"],
			part["trophies"],
			part["builderBaseTrophies"],
			part["donations"],
			part["donationsReceived"],
		};

		players.push_back(player);
	}

	return players;
}

CapitalRaid APIClient::getRaidInfo() const {
	std::string url = "/clans/%23" + getClanTag().substr(1, getClanTag().length() - 1) + "/capitalraidseasons?limit=1";
	auto response = getResponse(url);

	json parsed = json::parse(response.text);
	
	CapitalRaid raid;
	for (const auto& part : parsed["items"]) {
		raid = {
			getClanTag(),
			part["endTime"],
			part["capitalTotalLoot"],
			part["raidsCompleted"],
			part["totalAttacks"],
			part["enemyDistrictsDestroyed"],
			part["offensiveReward"],
			part["defensiveReward"],
		};
	}

	return raid;
}

std::map<std::string, std::vector<PlayerRaidStats>> APIClient::getPlayersRaidInfo() const {
	std::string url = "/clans/%23" + getClanTag().substr(1, getClanTag().length() - 1) + "/capitalraidseasons?limit=1";
	auto response = getResponse(url);

	json parsed = json::parse(response.text);

	std::vector<PlayerRaidStats> players;
	std::string time; int flag = 0;
	for (const auto& part : parsed["items"]) {

		if (part["state"] == "ongoing") {
			if (!flag) {
				time = part["endTime"].get<std::string>();
				flag = 1;
			}

			for (const auto& member : part["members"]) {
				PlayerRaidStats player = {
					member["tag"],
					member["name"],
					member["attacks"],
					member["capitalResourcesLooted"],
				};

				players.push_back(player);
			}

		}
		else return {};
		
	}

	std::map<std::string, std::vector<PlayerRaidStats>> data = {
		std::pair<std::string, std::vector<PlayerRaidStats>>{time,players}
	};

	return data;
}
