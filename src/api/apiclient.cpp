#include "../api/apiclient.h"
#include "../models/models.h"

#include <cpr/cpr.h>
#include <nlohmann/json.hpp>
#include <iostream>
#include <vector>
#include <map>

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
	std::string url = "/clans/%23" + getClanTag().substr(1);
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
	std::string url = "/clans/%23" + getClanTag().substr(1) + "/members";
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
	std::string url = "/clans/%23" + getClanTag().substr(1) + "/capitalraidseasons?limit=1";
	auto response = getResponse(url);

	if (response.status_code != 200) return {};

	json parsed = json::parse(response.text);

	if (!parsed.contains("items") || parsed["items"].empty()) {
		return {};
	}

	const auto& part = parsed["items"][0];

	std::string state = part.value("state", "");
	if (state == "scheduled") {
		std::cout << "Рейды еще не начались" << std::endl;
		return {};
	}
	
	CapitalRaid raid;

	raid.clanTag = getClanTag();

	std::string fullTime = part.value("endTime", "00000000");
	raid.date = fullTime.substr(0, 8);
	raid.state = state;

	raid.totalLoot = part.value("capitalTotalLoot", 0);
	raid.raidsCompleted = part.value("raidsCompleted", 0);
	raid.totalAttacks = part.value("totalAttacks", 0);
	raid.enemyDistrictsDestroyed = part.value("enemyDistrictsDestroyed", 0);
	raid.offensiveReward = part.value("offensiveReward", 0);
	raid.defensiveReward = part.value("defensiveReward", 0);

	if (part.contains("members")) {
		for (const auto& m : part["members"]) {
			PlayerRaidStats member;
			member.playerTag = m.value("tag", "");
			member.name = m.value("name", "Unknown");
			member.attacksCount = m.value("attacks", 0);
			member.totalLoot = m.value("capitalResourcesLooted", 0);

			raid.members.push_back(member);
		}
	}

	return raid;
}

std::vector<PlayerRaidStats> APIClient::getPlayersRaidInfo() const {
	auto raid = getRaidInfo();
	return raid.members;
}

ClanWar APIClient::getClanwarInfo() const {
	std::string url = "/clans/%23" + getClanTag().substr(1) + "/currentwar";
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
	std::string url = "/clans/%23" + getClanTag().substr(1) + "/currentwar";
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
	std::string leagueGroupUrl = "/clans/%23" + getClanTag().substr(1) + "/currentwar/leaguegroup";
	auto leagueGroup = getResponse(leagueGroupUrl);

	if (leagueGroup.status_code != 200) return {};

	std::string clanDataUrl = "/clans/%23" + getClanTag().substr(1);
	auto clanData = getResponse(clanDataUrl);

	try {
		json leagueGroupParsed = json::parse(leagueGroup.text);
		json clanDataParsed = json::parse(clanData.text);

		LeagueClanwarSeason season = {
			leagueGroupParsed.value("season", "Unknown"),
			getClanTag(),
			clanDataParsed["warLeague"].value("name", "Unranked"),
			leagueGroupParsed.value("state", "Unknown")
		};

		return season;
	}
	catch (const json::parse_error& e) {
		return {};
	}
}

std::vector<LeagueClanwarRound> APIClient::getLeagueClanwarRoundsInfo() const {
	std::string leagueGroupUrl = "/clans/%23" + getClanTag().substr(1) + "/currentwar/leaguegroup";
	auto leagueGroup = getResponse(leagueGroupUrl);

	if (leagueGroup.text.empty() || leagueGroup.status_code != 200) return {};

	json parsed = json::parse(leagueGroup.text);
	if (!parsed.contains("rounds") || !parsed.contains("season")) return {};

	std::vector<LeagueClanwarRound> rounds; unsigned short counter = 1;
	for (const auto& round : parsed["rounds"]) {

		if (!round.contains("warTags")) continue;

		for (const auto& war : round["warTags"]) {
			std::string warTag = war.get<std::string>();

			if (warTag == "#0" || warTag.length() < 2) continue;

			std::string warUrl = "/clanwarleagues/wars/%23" + war.get<std::string>().substr(1);
			auto singleWar = getResponse(warUrl);

			if (singleWar.status_code != 200) continue;

			json warParsed = json::parse(singleWar.text);

			std::string clanTag = warParsed["clan"]["tag"];
			std::string opponentTag = warParsed["opponent"]["tag"];
			std::string myTag = getClanTag();

			if (clanTag == myTag || opponentTag == myTag) {
				rounds.push_back({
					warTag,
					parsed["season"].get<std::string>(),
					counter++,
					(clanTag == myTag) ? opponentTag : clanTag
				});

				break;
			}
		}
	}

	return rounds;
}

std::vector<LeagueClanwarAttack> APIClient::getLeagueClanwarAttacksInfo(const std::vector<LeagueClanwarRound>& rounds) const {
	struct MemberInfo {
		int mapPos;
		int thLevel;
	};
	
	std::vector<LeagueClanwarAttack> attacks;
	for (const auto& round : rounds) {
		if (round.warTag.empty() || round.warTag == "#0") {
			continue;
		}

		std::string warUrl = "/clanwarleagues/wars/%23" + round.warTag.substr(1);
		auto war = getResponse(warUrl);

		if (war.text.empty()) continue;

		json warParsed = json::parse(war.text);

		if (!warParsed.contains("state") || !warParsed.contains("clan") || !warParsed.contains("opponent")) {
			continue;
		}

		std::string warState = warParsed["state"];
		std::map<std::string, MemberInfo> playersLookup;

		for (const std::string side : {"clan", "opponent"}) {
			for (const auto& m : warParsed[side]["members"]) {
				playersLookup[m["tag"]] = { m["mapPosition"], m["townhallLevel"] };
			}
		}

		auto processMembers = [&](const json& sideData) {
            std::string currentClanTag = sideData["tag"];
            
            for (const auto& member : sideData["members"]) {
                std::string aTag = member["tag"];

				if (playersLookup.find(aTag) == playersLookup.end()) continue;

                unsigned short aPos = (unsigned short)playersLookup[aTag].mapPos;
				unsigned short aTH  = (unsigned short)playersLookup[aTag].thLevel;

                if (member.contains("attacks") && !member["attacks"].empty()) {
                 
                    for (const auto& jsonAttack : member["attacks"]) {
                        std::string dTag = jsonAttack["defenderTag"];

						if (playersLookup.find(dTag) == playersLookup.end()) continue;

						unsigned short dPos = (unsigned short)playersLookup[dTag].mapPos;
						unsigned short dTH  = (unsigned short)playersLookup[dTag].thLevel;

                        attacks.push_back({
                            round.warTag,
                            currentClanTag,
                            aTag,
                            aPos,
                            dTag,
                            dPos,
                            (aPos == dPos) ? "Mirror" : "Not mirror",
                            jsonAttack["stars"],
                            jsonAttack["destructionPercentage"],
                            jsonAttack["duration"],
                            aTH,
                            dTH
                        });
                    }
                } 
                else if (warState == "warEnded") {
                    attacks.push_back({
                        round.warTag,
                        currentClanTag,
                        aTag,
                        aPos,
                        "NONE",
                        0,
                        "Missed",
                        0, 0, 0,
                        aTH, 0
                    });
                }
            }
        };

        // 4. Запускаем обработку для обеих сторон
        processMembers(warParsed["clan"]);
        processMembers(warParsed["opponent"]);
	}

	return attacks;
}

std::vector<LeagueClanwarMember> APIClient::getLeagueClanwarMembers() const {
	std::string leagueGroupUrl = "/clans/%23" + getClanTag().substr(1) + "/currentwar/leaguegroup";
	auto leagueGroup = getResponse(leagueGroupUrl);

	if (leagueGroup.text.empty() || leagueGroup.status_code != 200) return {};

	try {
		json parsed = json::parse(leagueGroup.text);

		if (!parsed.contains("clans") || !parsed.contains("season")) return {};

		std::string seasonId = parsed["season"];
		std::vector<LeagueClanwarMember> members;

		for (const auto& clan : parsed["clans"]) {
			std::string clanTag = clan["tag"];

			if (!clan.contains("members")) continue;

			for (const auto& member : clan["members"]) {
				members.push_back({
					member["tag"],
					seasonId,
					member["name"],
					clanTag
				});
			}
		}
		return members;
	}
	catch (const json::parse_error& e) {
		return {};
	}
}
