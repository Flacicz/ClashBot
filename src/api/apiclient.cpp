#include "../api/apiclient.h"
#include "../models/models.h"

#include <cpr/response.h>
#include <cpr/cprtypes.h>
#include <cpr/ssl_options.h>
#include <cpr/timeout.h>
#include <cpr/api.h>

#include <nlohmann/json.hpp>
#include <nlohmann/json_fwd.hpp>

#include <vector>
#include <string>
#include <chrono>
#include <stdexcept>
#include <string_view>
#include <optional>
#include <exception>

using json = nlohmann::json;

APIClient::APIClient(const std::string& token, bool tunnel, const std::string& baseUrl, const std::string& tunnelUrl)
	: apiToken(token), isTunnel(tunnel), baseUrl(baseUrl), tunnelUrl(tunnelUrl) {}

std::string APIClient::normalizeTag(std::string_view tag) {
	if (tag.empty()) return "";

	return tag.front() == '#' ? "%23" + std::string(tag.substr(1)) : "%23" + std::string(tag);
}

nlohmann::json APIClient::fetchJson(std::string_view endpoint) const {
	std::string url = (isTunnel ? tunnelUrl : baseUrl) + std::string(endpoint);

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
		throw std::runtime_error("Not Found: " + std::string(endpoint));
	}
	if (response.status_code == 429) {
		throw std::runtime_error("Rate Limit Exceeded!");
	}
	if (response.status_code == 403) {
		throw std::runtime_error("Access Denied: Invalid Token or IP not allowed.");
	}
	if (response.status_code != 200) {
		throw std::runtime_error("API Error [" + std::to_string(response.status_code) + "] at: " + std::string(endpoint));
	}

	try {
		return json::parse(response.text);
	}
	catch (const nlohmann::json::parse_error& e) {
		throw std::runtime_error("JSON Parse Error at " + std::string(endpoint) + ": " + e.what());
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

std::optional<ClanwarwarsLeagueSeason> APIClient::getLeagueClanwarSeasonInfo(std::string_view tag) const {
	json leagueGroupParsed;

	try {
		leagueGroupParsed = fetchJson("/clans/" + normalizeTag(tag) + "/currentwar/leaguegroup");
	}
	catch (const std::runtime_error& e) {
		std::string errStr(e.what());
		if (errStr.find("Not Found") != std::string::npos) {
			return std::nullopt;
		}
		throw;
	}

	std::string state = leagueGroupParsed.value("state", "notInWar");
	if (state == "notInWar") {
		return std::nullopt;
	}

	ClanInfo clanInfo = getClanInfo(tag);

	return ClanwarwarsLeagueSeason::fromJson(leagueGroupParsed, tag, clanInfo.warLeague);
}

std::vector<ClanwarsLeagueRound> APIClient::getLeagueClanwarRoundsInfo(std::string_view tag) const {
	nlohmann::json parsed;

	try {
		parsed = fetchJson("/clans/" + normalizeTag(tag) + "/currentwar/leaguegroup");
	}
	catch (const std::runtime_error& e) {
		std::string errStr(e.what());
		if (errStr.find("Not Found") != std::string::npos) return {};
		throw;
	}

	if (!parsed.contains("rounds") || !parsed["rounds"].is_array()) return {};

	std::vector<ClanwarsLeagueRound> rounds;
	rounds.reserve(parsed["rounds"].size());

	std::string season = parsed.value("season", "0000-00");
	unsigned short counter = 1;
	std::string myTag(tag);

	for (const auto& round : parsed["rounds"]) {
		if (!round.contains("warTags") || !round["warTags"].is_array()) continue;

		for (const auto& warTagJson : round["warTags"]) {
			std::string warTag = warTagJson.get<std::string>();

			if (warTag == "#0" || warTag.length() < 2) continue;

			nlohmann::json warParsed;
			try {
				warParsed = fetchJson("/clanwarleagues/wars/" + normalizeTag(warTag));
			}
			catch (const std::exception&) {
				continue;
			}

			std::string attackerTag = warParsed.value("/clan/tag"_json_pointer, "");
			std::string defenderTag = warParsed.value("/opponent/tag"_json_pointer, "");

			if (myTag == attackerTag || myTag == defenderTag) {
				rounds.push_back({
					warTag,
					season,
					counter,
					(myTag == attackerTag) ? defenderTag : attackerTag
				});
				break;
			}
		}
		counter++;
	}

	return rounds;
}

std::vector<ClanwarsLeagueAttacks> APIClient::getLeagueClanwarAttacksInfo(std::string_view tag, const std::vector<ClanwarsLeagueRound>& rounds) const {
	std::vector<ClanwarsLeagueAttacks> allAttacks;
	
	for (const auto& round : rounds) {
		if (round.warTag.empty() || round.warTag == "#0") {
			continue;
		}

		try {
			nlohmann::json warParsed = fetchJson("/clanwarleagues/wars/" + normalizeTag(round.warTag));

			std::vector<ClanwarsLeagueAttacks> roundAttacks = ClanwarsLeagueAttacks::parseAttackList(warParsed, round.warTag);

			allAttacks.insert(allAttacks.end(), roundAttacks.begin(), roundAttacks.end());
		}
		catch (const std::exception& e) {
			continue;
		}
	}

	return allAttacks;
}

std::vector<ClanwarsLeagueMembers> APIClient::getLeagueClanwarMembers(std::string_view tag) const {
	nlohmann::json parsed;

	try {
		parsed = fetchJson("/clans/" + normalizeTag(tag) + "/currentwar/leaguegroup");
	}
	catch (const std::runtime_error& e) {
		std::string errStr(e.what());
		if (errStr.find("Not Found") != std::string::npos) return {};
		throw;
	}

	std::string state = parsed.value("state", "notInWar");
	if (state == "notInWar") {
		return {};
	}

	return ClanwarsLeagueMembers::parseClanwarsLeagueMembers(parsed);
}
