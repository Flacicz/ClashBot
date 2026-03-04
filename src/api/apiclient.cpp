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
		if (part["state"] == "ongoing") {
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
		else {
			std::cout << "Рейд не идет в данное время" << std::endl;
			return {};
		}
	}

	return raid;
}

std::vector<PlayerRaidStats> APIClient::getPlayersRaidInfo() const {
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
		else {
			std::cout << "Рейд не идет в данное время" << std::endl;
			return {};
		}
	}

	return players;
}

ClanWar APIClient::getClanwarInfo() const {
	std::string url = "/clans/%23" + getClanTag().substr(1, getClanTag().length() - 1) + "/currentwar";
	auto response = getResponse(url);

	json parsed = json::parse(response.text);

	ClanWar clanwar;
	if (parsed["state"] == "ended") {
		std::string win = (parsed["clan"]["stars"] > parsed["opponent"]["stars"]) ? "win" :
			(parsed["clan"]["stars"] < parsed["opponent"]["stars"]) ? "lose" :
			(parsed["clan"]["destructionPercentage"] > parsed["opponent"]["destructionPercentage"]) ? "win" :
			(parsed["clan"]["destructionPercentage"] < parsed["opponent"]["destructionPercentage"]) ? "lose" : "tie";
		
		clanwar = {
			getClanTag(),
			parsed["endTime"],
			parsed["teamSize"],
			parsed["clan"]["attacks"],
			parsed["clan"]["stars"],
			win,
			parsed["expEarned"],
			parsed["clan"]["destructionPercentage"],
		};
	}
	else {
		std::cout << "Клановая война не идет в данное время" << std::endl;
		return {};
	}

	return clanwar;
}

std::vector<PlayerWarStats> APIClient::getPlayersClanwarInfo() const {
	std::string url = "/clans/%23" + getClanTag().substr(1, getClanTag().length() - 1) + "/currentwar";
	auto response = getResponse(url);

	json parsed = json::parse(response.text);

	std::vector<PlayerWarStats> players;
	std::string time;
	if (parsed["state"] == "ended") {

		time = parsed["endTime"].get<std::string>();
		for (const auto& member : parsed["clan"]["members"]) {
			if (!member.contains("attacks")) continue;

			std::string rules;
			for (const auto& opponent : parsed["opponent"]["members"]) {
				if (!member["attacks"].empty() && opponent["tag"] == member["attacks"][0]["defenderTag"]) {
					rules = (member["mapPosition"] == opponent["mapPosition"]) ? "mirror" : "not mirror";
					break;
				}
			}

			PlayerWarStats player = {
				member["tag"],
				(member.contains("attacks")) ? member["attacks"].size() : 0,
				(member.contains("attacks")) ? member["attacks"][0]["stars"].get<int>() : 0,
				member["mapPosition"],
				rules
			};

			players.push_back(player);
		}

	}

	return players;
}

LeagueClanwarSeason APIClient::getLeagueClanwarSeasonInfo() const {
	std::string leagueGroupUrl = "/clans/%23" + getClanTag().substr(1, getClanTag().length() - 1) + "/currentwar/leaguegroup";
	auto leagueGroup = getResponse(leagueGroupUrl);

	std::string clanDataUrl = "/clans/%23" + getClanTag().substr(1, getClanTag().length() - 1);
	auto clanData = getResponse(clanDataUrl);

	json leagueGroupParsed = json::parse(leagueGroup.text);
	json clanDataParsed = json::parse(clanData.text);

	LeagueClanwarSeason season = {
		leagueGroupParsed["season"],
		getClanTag(),
		clanDataParsed["warLeague"]["name"],
		leagueGroupParsed["state"]
	};

	return season;
}

std::vector<LeagueClanwarRound> APIClient::getLeagueClanwarRoundsInfo() const {
	std::string leagueGroupUrl = "/clans/%23" + getClanTag().substr(1, getClanTag().length() - 1) + "/currentwar/leaguegroup";
	auto leagueGroup = getResponse(leagueGroupUrl);

	json parsed = json::parse(leagueGroup.text);

	std::vector<LeagueClanwarRound> rounds; int counter = 1;
	for (const auto& round : parsed["rounds"]) {
		for (const auto& war : round["warTags"]) {
			std::string warUrl = "/clanwarleagues/wars/%23" + war.get<std::string>().substr(1, getClanTag().length() - 1);
			auto singleWar = getResponse(warUrl);

			json warParsed = json::parse(singleWar.text);

			if (warParsed["clan"]["tag"] == getClanTag() || warParsed["opponent"]["tag"] == getClanTag()) {
				LeagueClanwarRound warRound = {
					war.get<std::string>(),
					parsed["season"],
					counter++,
					(warParsed["clan"]["tag"] == getClanTag()) ? warParsed["opponent"]["tag"] : warParsed["clan"]["tag"]
				};

				rounds.push_back(warRound);

				break;
			}
		}
	}

	return rounds;
}
