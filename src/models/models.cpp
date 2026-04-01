#include "../../include/models/models.h"

#include <nlohmann/json.hpp>
#include <nlohmann/json_fwd.hpp>
#include <string>
#include <unordered_map>
#include <vector>

ClanInfo ClanInfo::fromJson(const nlohmann::json& j) {
	ClanInfo clanInfo;

	clanInfo.tag = j.value("tag", "");
	clanInfo.name = j.value("name", "Unknown");
	clanInfo.type = j.value("type", "unknown");
	clanInfo.description = j.value("description", "");
	clanInfo.members = j.value("members", 0);

	clanInfo.clanLevel = j.value("clanLevel", 0);
	clanInfo.clanPoints = j.value("clanPoints", 0);
	clanInfo.clanBuilderPoints = j.value("clanBuilderBasePoints", 0);
	clanInfo.clanCapitalPoints = j.value("clanCapitalPoints", 0);

	clanInfo.capitalHallLevel = j.value("/clanCapital/capitalHallLevel"_json_pointer, 0);

	clanInfo.capitalLeague = j.value("/capitalLeague/name"_json_pointer, "Unranked");

	clanInfo.requiredTrophies = j.value("requiredTrophies", 0);
	clanInfo.requiredBuilderBaseTrophies = j.value("requiredBuilderBaseTrophies", 0);
	clanInfo.requiredTownhallLevel = j.value("requiredTownhallLevel", 1);

	clanInfo.warFrequency = j.value("warFrequency", "unknown");
	clanInfo.isWarLogPublic = j.value("isWarLogPublic", false);
	clanInfo.warWinStreak = j.value("warWinStreak", 0);
	clanInfo.warWins = j.value("warWins", 0);
	clanInfo.warTies = j.value("warTies", 0);
	clanInfo.warLosses = j.value("warLosses", 0);

	clanInfo.warLeague = j.value("/warLeague/name"_json_pointer, "Unranked");

	clanInfo.locationName = j.value("/location/name"_json_pointer, "Unknown");

	clanInfo.chatLanguage = j.value("/chatLanguage/name"_json_pointer, "Not set");

	return clanInfo;
}

Player Player::fromJson(const nlohmann::json& j, std::string_view clanTag) {
	Player player;

	player.tag = j.value("tag", "");
	player.clanTag = std::string(clanTag);
	player.name = j.value("name", "Unknown");
	player.role = j.value("role", "member");
	player.townHallLevel = j.value("townHallLevel", 1);
	player.expLevel = j.value("expLevel", 1);

	player.leagueTier = j.value("/league/name"_json_pointer, "Unranked");

	player.trophies = j.value("trophies", 0);
	player.builderBaseTrophies = j.value("builderBaseTrophies", 0);
	player.clanRank = j.value("clanRank", 0);

	player.donations = j.value("donations", 0);
	player.donationsReceived = j.value("donationsReceived", 0);

	return player;
}

PlayerRaidStats PlayerRaidStats::fromJson(const nlohmann::json& j) {
	PlayerRaidStats player;

	player.playerTag = j.value("tag", "");
	player.name = j.value("name", "Unknown");
	player.attacksCount = j.value("attacks", 0);
	player.totalLoot = j.value("capitalResourcesLooted", 0);

	return player;
}

CapitalRaid CapitalRaid::fromJson(const nlohmann::json& j, std::string_view clanTag) {
	CapitalRaid raid;

	raid.clanTag = std::string(clanTag);

	std::string fullTime = j.value("endTime", "00000000");
	raid.date = fullTime.length() >= 8 ? fullTime.substr(0, 8) : fullTime;
	raid.state = j.value("state", "");

	raid.totalLoot = j.value("capitalTotalLoot", 0);
	raid.raidsCompleted = j.value("raidsCompleted", 0);
	raid.totalAttacks = j.value("totalAttacks", 0);
	raid.enemyDistrictsDestroyed = j.value("enemyDistrictsDestroyed", 0);
	raid.offensiveReward = j.value("offensiveReward", 0);
	raid.defensiveReward = j.value("defensiveReward", 0);

	if (j.contains("members") && j["members"].is_array()) {
		const auto& membersJson = j["members"];
		raid.members.reserve(membersJson.size());

		for (const auto& m : membersJson) {
			raid.members.push_back(PlayerRaidStats::fromJson(m));
		}
	}

	return raid;
}

ClanwarSeason ClanwarSeason::fromJson(const nlohmann::json& j, std::string_view clanTag) {
	ClanwarSeason clanwarSeason;

	clanwarSeason.clanTag = std::string(clanTag);

	clanwarSeason.seasonId = j.value("preparationStartTime", "000000").substr(0, 6);

	return clanwarSeason;
}

ClanWar ClanWar::fromJson(const nlohmann::json& j, std::string_view clanTag) {
	ClanWar clanwar;

	std::string state = j.value("state", "notInWar");

	std::string prepTime = j.value("preparationStartTime", "00000000");
	clanwar.seasonId = prepTime.length() >= 6 ? prepTime.substr(0, 6) : prepTime;
	clanwar.prepStartTime = prepTime;

	clanwar.clanTag = std::string(clanTag);

	clanwar.opponentTag = j.value("/opponent/tag"_json_pointer, "Unknown");
	clanwar.opponentName = j.value("/opponent/name"_json_pointer, "Unknown");

	clanwar.teamSize = j.value("teamSize", 0);

	clanwar.clanStars = j.value("/clan/stars"_json_pointer, 0);
	clanwar.opponentStars = j.value("/opponent/stars"_json_pointer, 0);

	double clanDestr = j.value("/clan/destructionPercentage"_json_pointer, 0);
	double oppDestr = j.value("/opponent/destructionPercentage"_json_pointer, 0);

	clanwar.result = "ongoing";

	if (state == "warEnded") {
		if (clanwar.clanStars > clanwar.opponentStars) {
			clanwar.result = "win";
		}
		else if (clanwar.clanStars < clanwar.opponentStars) {
			clanwar.result = "lose";
		}
		else {
			if (clanDestr > oppDestr) clanwar.result = "win";
			else if (clanDestr < oppDestr) clanwar.result = "lose";
			else clanwar.result = "tie";
		}
	}

	return clanwar;
}

std::vector<ClanwarAttack> ClanwarAttack::parseAttacksList(const nlohmann::json& j, std::string_view clanTag) {
	std::vector<ClanwarAttack> attacks;
	std::string state = j.value("state", "notInWar");
	if (state == "notInWar") return attacks;

	std::string ourClanTag(clanTag);

	struct MemberInfo {
		unsigned short mapPos;
		unsigned short thLevel;
	};

	std::unordered_map<std::string, MemberInfo> playersLookup;
	std::unordered_map<std::string, int> attacksCount;

	for (const char* side : { "clan", "opponent" }) {
		if (j.contains(side) && j[side].contains("members") && j[side]["members"].is_array()) {
			for (const auto& m : j[side]["members"]) {
				playersLookup[m.value("tag", "")] = {
					(unsigned short)m.value("mapPosition", 0),
					(unsigned short)m.value("townhallLevel", 0)
				};
			}
		}
	}

	auto processMembers = [&](const nlohmann::json& sideData) {
		if (!sideData.contains("members") || !sideData["members"].is_array()) return;

		std::string currentClanTag = sideData.value("tag", "");
		bool isOurClan = (currentClanTag == ourClanTag);

		for (const auto& member : sideData["members"]) {
			std::string aTag = member.value("tag", "");
			std::string aName = member.value("name", "Unknown");

			auto it = playersLookup.find(aTag);
			if (it == playersLookup.end()) continue;

			unsigned short aPos = it->second.mapPos;
			unsigned short aTH = it->second.thLevel;

			if (member.contains("attacks") && member["attacks"].is_array() && !member["attacks"].empty()) {
				for (const auto& jsonAttack : member["attacks"]) {
					std::string dTag = jsonAttack.value("defenderTag", "");
					auto dIt = playersLookup.find(dTag);

					unsigned short dPos = (dIt != playersLookup.end()) ? dIt->second.mapPos : 0;
					unsigned short dTH = (dIt != playersLookup.end()) ? dIt->second.thLevel : 0;

					std::string mirror;
					if (!attacksCount.count(aTag) && aPos == dPos) mirror = "Mirror";
					else mirror = "Not mirror";

					if (attacksCount.count(aTag)) mirror = "Second attack";

					attacks.push_back({
						aTag,
						aName,
						aTH,
						aPos,
						dTag,
						dTH,
						(unsigned short)jsonAttack.value("stars", 0),
						(unsigned short)jsonAttack.value("destructionPercentage", 0),
						(unsigned short)jsonAttack.value("duration", 0),
						(unsigned short)jsonAttack.value("order", 0),
						mirror,
						!isOurClan
					});

					attacksCount[aTag]++;
				}

				if (state == "warEnded" && isOurClan && member["attacks"].size() < 2) {
					attacks.push_back({
						aTag, aName, aTH, aPos, "NONE",
						0, 0, 0, 0, 998, "Missed (1/2)", false
					});
				}
			}
			else if (state == "warEnded" && isOurClan) {
				for (int i = 0; i < 2; ++i) {
					attacks.push_back({
						aTag, aName, aTH, aPos, "NONE",
						0, 0, 0, 0, (unsigned short)(990 + i), "Missed", false
					});
				}
			}
		}
	};

	if (state == "warEnded" || state == "inWar") {
		if (j.contains("clan")) processMembers(j["clan"]);
		if (j.contains("opponent")) processMembers(j["opponent"]);
	}

	return attacks;
}