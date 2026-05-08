#include "api/apiclient.h"
#include "models/models.h"

#include <cpr/response.h>
#include <cpr/cprtypes.h>
#include <cpr/ssl_options.h>
#include <cpr/timeout.h>
#include <cpr/api.h>

#include <nlohmann/json.hpp>

#include <vector>
#include <string>
#include <chrono>
#include <stdexcept>
#include <string_view>
#include <optional>
#include <exception>

#include <spdlog/spdlog.h>

using json = nlohmann::json;

APIClient::APIClient(const std::string& token, const bool tunnel, const std::string& baseUrl, const std::string& tunnelUrl)
    : apiToken(token), baseUrl(baseUrl), tunnelUrl(tunnelUrl), isTunnel(tunnel) {
}

std::string APIClient::normalizeTag(const std::string_view tag) {
    if (tag.empty()) return "";
    return tag.front() == '#' ? "%23" + std::string(tag.substr(1)) : "%23" + std::string(tag);
}

nlohmann::json APIClient::fetchJson(std::string_view endpoint) const
{
    const std::string url = (isTunnel ? tunnelUrl : baseUrl) + std::string(endpoint);

    spdlog::debug("[API] Fetching data from: {}", endpoint);

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
        spdlog::error("[API] Network error: {} at {}", response.error.message, endpoint);
        throw std::runtime_error("Network error: " + response.error.message);
    }

    if (response.status_code == 404) {
        spdlog::warn("[API] Not Found (404) at {}", endpoint);
        throw std::runtime_error("Not Found: " + std::string(endpoint));
    }
    if (response.status_code == 429) {
        spdlog::error("[API] Rate Limit Exceeded (429) at {}", endpoint);
        throw std::runtime_error("Rate Limit Exceeded!");
    }
    if (response.status_code == 403) {
        spdlog::error("[API] Access Denied (403): Invalid Token or IP at {}", endpoint);
        throw std::runtime_error("Access Denied: Invalid Token or IP not allowed.");
    }
    if (response.status_code != 200) {
        spdlog::error("[API] Unexpected Error [{}] at {}", response.status_code, endpoint);
        throw std::runtime_error("API Error [" + std::to_string(response.status_code) + "] at: " + std::string(endpoint));
    }

    try {
        auto parsed_data = json::parse(response.text);
        return parsed_data;
    }
    catch (const nlohmann::json::parse_error& e) {
        spdlog::error("[API] JSON Parse Error at {}: {}", endpoint, e.what());
        throw std::runtime_error("JSON Parse Error at " + std::string(endpoint) + ": " + e.what());
    }
}

ClanInfo APIClient::getClanInfo(const std::string_view clanTag) const {
    const json parsed = fetchJson("/clans/" + normalizeTag(clanTag));
    return ClanInfo::fromJson(parsed);
}

std::vector<Player> APIClient::getPlayersInfo(const std::string_view clanTag) const {
    json parsed = fetchJson("/clans/" + normalizeTag(clanTag));

    if (!parsed.contains("memberList") || !parsed["memberList"].is_array()) {
        return {};
    }

    const auto& memberList = parsed["memberList"];
    std::vector<Player> players;
    players.reserve(memberList.size());

    for (const auto& part : memberList) {
        players.push_back(Player::fromJson(part, clanTag));
    }

    return players;
}

std::optional<CapitalRaid> APIClient::getRaidInfo(const std::string_view clanTag) const {
    json parsed = fetchJson("/clans/" + normalizeTag(clanTag) + "/capitalraidseasons?limit=1");

    if (!parsed.contains("items") || parsed["items"].empty()) {
        return std::nullopt;
    }

    const auto& part = parsed["items"][0];

    if (const std::string state = part.value("state", ""); state == "scheduled") {
        return std::nullopt;
    }

    return CapitalRaid::fromJson(part, clanTag);
}

std::vector<PlayerRaidStats> APIClient::getPlayersRaidInfo(const std::string_view clanTag) const {
    if (auto raidOpt = getRaidInfo(clanTag); raidOpt.has_value()) {
        return raidOpt->members;
    }
    return {};
}

std::optional<ClanwarSeason> APIClient::getClanwarSeason(const std::string_view clanTag) const {
    const json parsed = fetchJson("/clans/" + normalizeTag(clanTag) + "/currentwar");

    if (parsed.value("state", "notInWar") == "notInWar") {
        return std::nullopt;
    }
    if (!parsed.contains("preparationStartTime")) {
        return std::nullopt;
    }
    return ClanwarSeason::fromJson(parsed, clanTag);
}

std::optional<ClanWar> APIClient::getClanwarInfo(const std::string_view clanTag) const {
    const json parsed = fetchJson("/clans/" + normalizeTag(clanTag) + "/currentwar");

    if (parsed.value("state", "notInWar") == "notInWar") {
        return std::nullopt;
    }
    return ClanWar::fromJson(parsed, clanTag);
}

std::vector<ClanwarAttack> APIClient::getClanwarAttacks(const std::string_view clanTag) const {
    const json parsed = fetchJson("/clans/" + normalizeTag(clanTag) + "/currentwar");

    if (const std::string state = parsed.value("state", "notInWar"); state == "notInWar") {
        return {};
    }
    return ClanwarAttack::parseAttacksList(parsed, clanTag);
}

std::optional<ClanwarwarsLeagueSeason> APIClient::getLeagueClanwarSeasonInfo(const std::string_view clanTag) const {
    json leagueGroupParsed;

    try {
        leagueGroupParsed = fetchJson("/clans/" + normalizeTag(clanTag) + "/currentwar/leaguegroup");
    }
    catch (const std::runtime_error& e) {
        if (const std::string errStr(e.what()); errStr.find("Not Found") != std::string::npos) {
            return std::nullopt;
        }
        throw;
    }

    if (const std::string state = leagueGroupParsed.value("state", "notInWar"); state == "notInWar") {
        return std::nullopt;
    }

    const ClanInfo clanInfo = getClanInfo(clanTag);
    return ClanwarwarsLeagueSeason::fromJson(leagueGroupParsed, clanTag, clanInfo.warLeague);
}

std::vector<ClanwarsLeagueRound> APIClient::getLeagueClanwarRoundsInfo(const std::string_view clanTag) const {
    nlohmann::json parsed;

    try {
        parsed = fetchJson("/clans/" + normalizeTag(clanTag) + "/currentwar/leaguegroup");
    }
    catch (const std::runtime_error& e) {
        if (std::string errStr(e.what()); errStr.find("Not Found") != std::string::npos) return {};
        throw;
    }

    if (!parsed.contains("rounds") || !parsed["rounds"].is_array()) return {};

    std::vector<ClanwarsLeagueRound> rounds;
    rounds.reserve(parsed["rounds"].size());

    std::string season = parsed.value("season", "0000-00");
    unsigned short counter = 1;
    std::string myTag(clanTag);

    for (const auto& round : parsed["rounds"]) {
        if (!round.contains("warTags") || !round["warTags"].is_array()) continue;

        for (const auto& warTagJson : round["warTags"]) {
            auto warTag = warTagJson.get<std::string>();

            if (warTag == "#0" || warTag.length() < 2) continue;

            nlohmann::json warParsed;
            try {
                warParsed = fetchJson("/clanwarleagues/wars/" + normalizeTag(warTag));
            }
            catch (const std::exception& e) {
                spdlog::warn("[API] Failed to fetch CWL round {}: {}", warTag, e.what());
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

std::vector<ClanwarsLeagueAttacks> APIClient::getLeagueClanwarAttacksInfo(const std::vector<ClanwarsLeagueRound>& rounds) const {
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
            spdlog::warn("[API] Failed to fetch attacks for CWL round {}: {}", round.warTag, e.what());
        }
    }

    return allAttacks;
}

std::vector<ClanwarsLeagueMembers> APIClient::getLeagueClanwarMembers(const std::string_view clanTag) const {
    nlohmann::json parsed;

    try {
        parsed = fetchJson("/clans/" + normalizeTag(clanTag) + "/currentwar/leaguegroup");
    }
    catch (const std::runtime_error& e) {
        if (const std::string errStr(e.what()); errStr.find("Not Found") != std::string::npos) return {};
        throw;
    }

    if (const std::string state = parsed.value("state", "notInWar"); state == "notInWar") {
        return {};
    }

    return ClanwarsLeagueMembers::parseClanwarsLeagueMembers(parsed);
}