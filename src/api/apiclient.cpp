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

ClanwarSeason APIClient::getClanwarSeason() const {
	std::string url = "/clans/%23" + getClanTag().substr(1) + "/currentwar";
	auto response = getResponse(url);
	
	if (response.status_code != 200) return {};

	json parsed = json::parse(response.text);

	if (!parsed.contains("preparationStartTime") || parsed["state"] == "notInWar") {
		return {};
	}

	ClanwarSeason season = {
		parsed["preparationStartTime"].get<std::string>().substr(0, 6),
		getClanTag()
	};

	return season;
}

ClanWar APIClient::getClanwarInfo() const {
	std::string url = "/clans/%23" + getClanTag().substr(1) + "/currentwar";
	auto response = getResponse(url);

	if (response.status_code != 200) return {};

	json parsed = json::parse(response.text);

	if (!parsed.contains("state") || parsed["state"] == "notInWar") {
		std::cout << "Клан не участвует в войне в данный момент." << std::endl;
		return {};
	}

	ClanWar clanwar;
	std::string state = parsed["state"];

	if (state == "warEnded" || state == "inWar") {

		int clanStars = parsed["clan"]["stars"].get<int>();
		int oppStars = parsed["opponent"]["stars"].get<int>();
		double clanDestr = parsed["clan"]["destructionPercentage"].get<double>();
		double oppDestr = parsed["opponent"]["destructionPercentage"].get<double>();

		std::string result = "ongoing";

		if (state == "warEnded") {
			if (clanStars > oppStars) result = "win";
			else if (clanStars < oppStars) result = "lose";
			else {
				if (clanDestr > oppDestr) result = "win";
				else if (clanDestr < oppDestr) result = "lose";
				else result = "tie";
			}
		}

		clanwar = {
			parsed["preparationStartTime"].get<std::string>().substr(0, 6),
			parsed["preparationStartTime"],
			getClanTag(),
			parsed["opponent"]["tag"],
			parsed["opponent"]["name"],
			(unsigned short)parsed["teamSize"].get<int>(),
			(unsigned short)clanStars,
			(unsigned short)oppStars,
			result
		};

	}
	else {
		std::cout << "Война в состоянии подготовки или не активна." << std::endl;
		return {};
	}

	return clanwar;
}

std::vector<ClanwarAttack> APIClient::getClanwarAttacks() const {
	struct MemberInfo {
		int mapPos;
		int thLevel;
	};

	std::string url = "/clans/%23" + getClanTag().substr(1) + "/currentwar";
	auto response = getResponse(url);
	if (response.status_code != 200) return {};

	json parsed = json::parse(response.text);
	std::string state = parsed["state"];
	if (state == "notInWar") return {};
	
	std::vector<ClanwarAttack> attacks;
	std::map<std::string, MemberInfo> playersLookup;

	for (const std::string side : {"clan", "opponent"}) {
		if (parsed.contains(side) && parsed[side].contains("members")) {
			for (const auto& m : parsed[side]["members"]) {
				playersLookup[m["tag"]] = { m["mapPosition"], m["townhallLevel"] };
			}
		}
	}

	auto processMembers = [&](const json& sideData) {
		std::string currentClanTag = sideData["tag"];
		bool isOurClan = (currentClanTag == getClanTag());

		for (const auto& member : sideData["members"]) {
			std::string aTag = member["tag"];
			auto it = playersLookup.find(aTag);
			if (it == playersLookup.end()) continue;

			unsigned short aPos = (unsigned short)it->second.mapPos;
			unsigned short aTH = (unsigned short)it->second.thLevel;

			if (member.contains("attacks") && !member["attacks"].empty()) {
				for (const auto& jsonAttack : member["attacks"]) {
					std::string dTag = jsonAttack["defenderTag"];
					auto dIt = playersLookup.find(dTag);

					unsigned short dPos = (dIt != playersLookup.end()) ? (unsigned short)dIt->second.mapPos : 0;
					unsigned short dTH = (dIt != playersLookup.end()) ? (unsigned short)dIt->second.thLevel : 0;

					attacks.push_back({
						aTag,
						member["name"],
						aTH,
						aPos,
						dTag,
						(unsigned short)jsonAttack["stars"].get<int>(),
						(unsigned short)jsonAttack["destructionPercentage"].get<int>(),
						(unsigned short)jsonAttack["duration"].get<int>(),
						(unsigned short)jsonAttack["order"].get<int>(),
						(aPos == dPos) ? "Mirror" : "Not mirror",
						!isOurClan
					});
				}

				if (state == "warEnded" && isOurClan && member["attacks"].size() < 2) {
					attacks.push_back({
						aTag, member["name"], aTH, aPos, "NONE",
						0, 0, 0, (unsigned short)998, "Missed (1/2)", false
					});
				}
			}
			else if (state == "warEnded" && isOurClan) {
				for (int i = 0; i < 2; ++i) {
					attacks.push_back({
						aTag, member["name"], aTH, aPos, "NONE",
						0, 0, 0, (unsigned short)(990 + i), "Missed", false
						});
				}
			}
		}
		};

	if (state == "warEnded" || state == "inWar") {
		processMembers(parsed["clan"]);
		processMembers(parsed["opponent"]);
	}

	return attacks;
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
