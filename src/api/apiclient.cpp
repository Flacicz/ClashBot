#include "../api/apiclient.h"
#include "../models/models.h"

#include <cpr/response.h>
#include <cpr/cprtypes.h>
#include <cpr/ssl_options.h>
#include <cpr/timeout.h>
#include <cpr/api.h>

#include <nlohmann/json.hpp>
#include <nlohmann/json_fwd.hpp>

#include <iostream>
#include <vector>
#include <map>
#include <string>
#include <chrono>
#include <stdexcept>
#include <string_view>
#include <optional>

using json = nlohmann::json;

APIClient::APIClient(const std::string& token, bool tunnel, const std::string& baseUrl, const std::string& tunnelUrl)
	: apiToken(token), isTunnel(tunnel), baseUrl(baseUrl), tunnelUrl(tunnelUrl) {}

APIClient::~APIClient() {}

std::string APIClient::normalizeTag(std::string_view tag) {
	if (tag.empty()) return "";

	return tag.front() == '#' ? "%23" + std::string(tag.substr(1)) : "%23" + std::string(tag);
}

nlohmann::json APIClient::fetchJson(const std::string& endpoint) const {
	std::string url = (isTunnel ? tunnelUrl : baseUrl) + endpoint;

	cpr::Response response = cpr::Get(
		cpr::Url{ url },
		cpr::Header{
			{"Authorization", "Bearer " + getApiToken()},
			{"Accept", "Application/json"},
		},
		cpr::VerifySsl(!getIsTunnel()),
		cpr::Timeout(std::chrono::milliseconds(10000))
	);

	if (response.error) {
		throw std::runtime_error("Network error: " + response.error.message);
	}


	if (response.status_code == 404) {
		throw std::runtime_error("Not Found: " + endpoint);
	}
	if (response.status_code == 429) {
		throw std::runtime_error("Rate Limit Exceeded!");
	}
	if (response.status_code == 403) {
		throw std::runtime_error("Access Denied: Invalid Token or IP not allowed.");
	}
	if (response.status_code != 200) {
		throw std::runtime_error("API Error [" + std::to_string(response.status_code) + "] at: " + endpoint);
	}

	try {
		return json::parse(response.text);
	}
	catch (const nlohmann::json::parse_error& e) {
		throw std::runtime_error("JSON Parse Error at " + endpoint + ": " + e.what());
	}
}

ClanInfo APIClient::getClanInfo(std::string_view tag) const {
	json parsed = fetchJson("/clans/" + normalizeTag(tag));

	return ClanInfo::fromJson(parsed);
}

std::vector<Player> APIClient::getPlayersInfo(std::string_view tag) const {
	json parsed = fetchJson("/clans/" + normalizeTag(tag));

	if (!parsed.contains("memberList") || !parsed["memberList"].is_array()) {
		return {};
	}

	const auto& memberList = parsed["memberList"];

	std::vector<Player> players;
	players.reserve(memberList.size());

	for (const auto& part : memberList) {
		players.push_back(Player::fromJson(part, tag));
	}

	return players;
}

std::optional<CapitalRaid> APIClient::getRaidInfo(std::string_view tag) const {
	json parsed = fetchJson("/clans/" + normalizeTag(tag) + "/capitalraidseasons?limit=1");

	if (!parsed.contains("items") || parsed["items"].empty()) {
		return std::nullopt;
	}

	const auto& part = parsed["items"][0];
	std::string state = part.value("state", "");

	if (state == "scheduled") {
		return std::nullopt;
	}
	
	return CapitalRaid::fromJson(part, tag);
}

std::vector<PlayerRaidStats> APIClient::getPlayersRaidInfo(std::string_view tag) const {
	auto raidOpt = getRaidInfo(tag);

	if (raidOpt.has_value()) {
		return raidOpt->members;
	}

	return {};
}

std::optional<ClanwarSeason> APIClient::getClanwarSeason(std::string_view tag) const {
	json parsed = fetchJson("/clans/" + normalizeTag(tag) + "/currentwar");

	if (parsed.value("state", "notInWar") == "notInWar") {
		return std::nullopt;
	}

	if (!parsed.contains("preparationStartTime")) {
		return std::nullopt;
	}

	return ClanwarSeason::fromJson(parsed, tag);
}

std::optional<ClanWar> APIClient::getClanwarInfo(std::string_view tag) const {
	json parsed = fetchJson("/clans/" + normalizeTag(tag) + "/currentwar");

	if (parsed.value("state", "notInWar") == "notInWar") {
		return std::nullopt;
	}

	return ClanWar::fromJson(parsed, tag);
}

std::vector<ClanwarAttack> APIClient::getClanwarAttacks(std::string_view tag) const {
	json parsed = fetchJson("/clans/" + normalizeTag(tag) + "/currentwar");

	std::string state = parsed.value("state", "notInWar");
	if (state == "notInWar") {
		return {};
	}

	return ClanwarAttack::parseAttacksList(parsed, tag);
}

//LeagueClanwarSeason APIClient::getLeagueClanwarSeasonInfo(std::string_view tag) const {
//	std::string leagueGroupUrl = "/clans/%23" + getClanTag().substr(1) + "/currentwar/leaguegroup";
//	auto leagueGroup = getResponse(leagueGroupUrl);
//
//	std::string clanDataUrl = "/clans/%23" + getClanTag().substr(1);
//	auto clanData = getResponse(clanDataUrl);
//
//	try {
//		json leagueGroupParsed = json::parse(leagueGroup.text);
//		json clanDataParsed = json::parse(clanData.text);
//
//		LeagueClanwarSeason season = {
//			leagueGroupParsed.value("season", "Unknown"),
//			getClanTag(),
//			clanDataParsed["warLeague"].value("name", "Unranked"),
//			leagueGroupParsed.value("state", "Unknown")
//		};
//
//		return season;
//	}
//	catch (const json::parse_error& e) {
//		return {};
//	}
//}
//
//std::vector<LeagueClanwarRound> APIClient::getLeagueClanwarRoundsInfo(std::string_view tag) const {
//	std::string leagueGroupUrl = "/clans/%23" + getClanTag().substr(1) + "/currentwar/leaguegroup";
//	auto leagueGroup = getResponse(leagueGroupUrl);
//
//	json parsed = json::parse(leagueGroup.text);
//	if (!parsed.contains("rounds") || !parsed.contains("season")) return {};
//
//	std::vector<LeagueClanwarRound> rounds; unsigned short counter = 1;
//	for (const auto& round : parsed["rounds"]) {
//
//		if (!round.contains("warTags")) continue;
//
//		for (const auto& war : round["warTags"]) {
//			std::string warTag = war.get<std::string>();
//
//			if (warTag == "#0" || warTag.length() < 2) continue;
//
//			std::string warUrl = "/clanwarleagues/wars/%23" + war.get<std::string>().substr(1);
//			cpr::Response singleWar;
//			try {
//				singleWar = getResponse(warUrl);
//			}
//			catch (const std::exception&) {
//				continue;
//			}
//
//			json warParsed = json::parse(singleWar.text);
//
//			std::string clanTag = warParsed["clan"]["tag"];
//			std::string opponentTag = warParsed["opponent"]["tag"];
//			std::string myTag = getClanTag();
//
//			if (clanTag == myTag || opponentTag == myTag) {
//				rounds.push_back({
//					warTag,
//					parsed["season"].get<std::string>(),
//					counter++,
//					(clanTag == myTag) ? opponentTag : clanTag
//				});
//
//				break;
//			}
//		}
//	}
//
//	return rounds;
//}
//
//std::vector<LeagueClanwarAttack> APIClient::getLeagueClanwarAttacksInfo(std::string_view tag, const std::vector<LeagueClanwarRound>& rounds) const {
//	struct MemberInfo {
//		int mapPos;
//		int thLevel;
//	};
//	
//	std::vector<LeagueClanwarAttack> attacks;
//	for (const auto& round : rounds) {
//		if (round.warTag.empty() || round.warTag == "#0") {
//			continue;
//		}
//
//		std::string warUrl = "/clanwarleagues/wars/%23" + round.warTag.substr(1);
//		auto war = getResponse(warUrl);
//
//		if (war.text.empty()) continue;
//
//		json warParsed = json::parse(war.text);
//
//		if (!warParsed.contains("state") || !warParsed.contains("clan") || !warParsed.contains("opponent")) {
//			continue;
//		}
//
//		std::string warState = warParsed["state"];
//		std::map<std::string, MemberInfo> playersLookup;
//
//		for (const std::string side : {"clan", "opponent"}) {
//			for (const auto& m : warParsed[side]["members"]) {
//				playersLookup[m["tag"]] = { m["mapPosition"], m["townhallLevel"] };
//			}
//		}
//
//		auto processMembers = [&](const json& sideData) {
//            std::string currentClanTag = sideData["tag"];
//            
//            for (const auto& member : sideData["members"]) {
//                std::string aTag = member["tag"];
//
//				if (playersLookup.find(aTag) == playersLookup.end()) continue;
//
//                unsigned short aPos = (unsigned short)playersLookup[aTag].mapPos;
//				unsigned short aTH  = (unsigned short)playersLookup[aTag].thLevel;
//
//                if (member.contains("attacks") && !member["attacks"].empty()) {
//                 
//                    for (const auto& jsonAttack : member["attacks"]) {
//                        std::string dTag = jsonAttack["defenderTag"];
//
//						if (playersLookup.find(dTag) == playersLookup.end()) continue;
//
//						unsigned short dPos = (unsigned short)playersLookup[dTag].mapPos;
//						unsigned short dTH  = (unsigned short)playersLookup[dTag].thLevel;
//
//                        attacks.push_back({
//                            round.warTag,
//                            currentClanTag,
//                            aTag,
//                            aPos,
//                            dTag,
//                            dPos,
//                            (aPos == dPos) ? "Mirror" : "Not mirror",
//                            jsonAttack["stars"],
//                            jsonAttack["destructionPercentage"],
//                            jsonAttack["duration"],
//                            aTH,
//                            dTH
//                        });
//                    }
//
//                } 
//                else if (warState == "warEnded") {
//                    attacks.push_back({
//                        round.warTag,
//                        currentClanTag,
//                        aTag,
//                        aPos,
//                        "NONE",
//                        0,
//                        "Missed",
//                        0, 0, 0,
//                        aTH, 0
//                    });
//                }
//            }
//        };
//
//        processMembers(warParsed["clan"]);
//        processMembers(warParsed["opponent"]);
//	}
//
//	return attacks;
//}
//
//std::vector<LeagueClanwarMember> APIClient::getLeagueClanwarMembers(std::string_view tag) const {
//	std::string leagueGroupUrl = "/clans/%23" + getClanTag().substr(1) + "/currentwar/leaguegroup";
//	auto leagueGroup = getResponse(leagueGroupUrl);
//
//	try {
//		json parsed = json::parse(leagueGroup.text);
//
//		if (!parsed.contains("clans") || !parsed.contains("season")) return {};
//
//		std::string seasonId = parsed["season"];
//		std::vector<LeagueClanwarMember> members;
//
//		for (const auto& clan : parsed["clans"]) {
//			std::string clanTag = clan["tag"];
//
//			if (!clan.contains("members")) continue;
//
//			for (const auto& member : clan["members"]) {
//				members.push_back({
//					member["tag"],
//					seasonId,
//					member["name"],
//					clanTag
//				});
//			}
//		}
//		return members;
//	}
//	catch (const json::parse_error& e) {
//		return {};
//	}
//}
