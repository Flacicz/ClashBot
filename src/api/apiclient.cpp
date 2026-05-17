#include "api/apiclient.h"
#include "models/models.h"
#include "common/StringUtils.h"

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

APIClient::APIClient(std::string token, const bool tunnel, std::string baseUrl, std::string tunnelUrl)
    : apiToken(std::move(token)),
      baseUrl(std::move(baseUrl)),
      tunnelUrl(std::move(tunnelUrl)),
      isTunnel(tunnel)
{
}

nlohmann::json APIClient::fetchJson(std::string_view endpoint) const
{
    const std::string url = (isTunnel ? tunnelUrl : baseUrl) + std::string(endpoint);

    spdlog::debug("[API] Fetching data from: {}", endpoint);

    cpr::Response response = cpr::Get(
        cpr::Url{url},
        cpr::Header{
            {"Authorization", "Bearer " + getApiToken()},
            {"Accept", "Application/json"},
        },
        cpr::VerifySsl(!getIsTunnel()),
        cpr::Timeout(std::chrono::milliseconds(10000))
    );

    if (response.error)
    {
        spdlog::error("[API] Network error: {} at {}", response.error.message, endpoint);
        throw std::runtime_error("Network error: " + response.error.message);
    }

    if (response.status_code == 404)
    {
        spdlog::warn("[API] Not Found (404) at {}", endpoint);
        throw std::runtime_error("Not Found: " + std::string(endpoint));
    }
    if (response.status_code == 429)
    {
        spdlog::error("[API] Rate Limit Exceeded (429) at {}", endpoint);
        throw std::runtime_error("Rate Limit Exceeded!");
    }
    if (response.status_code == 403)
    {
        spdlog::error("[API] Access Denied (403): Invalid Token or IP at {}", endpoint);
        throw std::runtime_error("Access Denied: Invalid Token or IP not allowed.");
    }
    if (response.status_code != 200)
    {
        spdlog::error("[API] Unexpected Error [{}] at {}", response.status_code, endpoint);
        throw std::runtime_error(
            "API Error [" + std::to_string(response.status_code) + "] at: " + std::string(endpoint));
    }

    try
    {
        auto parsed_data = json::parse(response.text);
        return parsed_data;
    }
    catch (const nlohmann::json::parse_error& e)
    {
        spdlog::error("[API] JSON Parse Error at {}: {}", endpoint, e.what());
        throw std::runtime_error("JSON Parse Error at " + std::string(endpoint) + ": " + e.what());
    }
}

std::optional<CompleteClanData> APIClient::getCompleteClanData(const std::string_view clanTag) const
{
    nlohmann::json parsed;

    try
    {
        parsed = fetchJson("/clans/" + utils::transformTag(clanTag));
    }
    catch (const std::runtime_error& e)
    {
        if (const std::string errStr(e.what()); errStr.find("Not Found") != std::string::npos)
        {
            return std::nullopt;
        }
        throw;
    }

    if (!parsed.contains("tag") || !parsed.contains("memberList") || !parsed["memberList"].is_array())
    {
        spdlog::error("[API] Received invalid clan JSON structure for tag: {}", clanTag);
        return std::nullopt;
    }

    CompleteClanData data;
    data.clan = Clan::fromJson(parsed);
    data.clanSnapshot = ClanSnapshot::fromJson(parsed);
    data.players = Player::parsePlayersList(parsed);
    data.playerSnapshots = PlayerSnapshot::parsePlayerSnapshotList(parsed, data.clan.tag);

    return data;
}

std::optional<CompleteRaidData> APIClient::getCompleteRaidData(const std::string_view clanTag) const
{
    nlohmann::json parsed;
    try
    {
        parsed = fetchJson("/clans/" + utils::transformTag(clanTag) + "/capitalraidseasons?limit=1");
    }
    catch (const std::runtime_error& e)
    {
        if (const std::string errStr(e.what()); errStr.find("Not Found") != std::string::npos)
        {
            return std::nullopt;
        }
        throw;
    }

    if (!parsed.contains("items") || !parsed["items"].is_array() || parsed["items"].empty())
    {
        return std::nullopt;
    }

    const auto& part = parsed["items"][0];

    if (const std::string state = part.value("state", ""); state == "scheduled")
    {
        return std::nullopt;
    }

    if (!part.contains("members") || !part["members"].is_array())
    {
        return std::nullopt;
    }

    CompleteRaidData completeRaidData;
    completeRaidData.clanRaid = ClanRaid::fromJson(part, clanTag);
    completeRaidData.playerRaidSnapshots = PlayerRaidSnapshot::fromJson(part["members"]);

    return completeRaidData;
}

std::optional<CompleteClanwarData> APIClient::getCompleteClanwarData(std::string_view clanTag) const
{
    nlohmann::json parsed;
    try
    {
        parsed = fetchJson("/clans/" + utils::transformTag(clanTag) + "/currentwar");
    }
    catch (const std::runtime_error& e)
    {
        if (const std::string errStr(e.what()); errStr.find("Not Found") != std::string::npos)
        {
            return std::nullopt;
        }
        throw;
    }

    if (parsed.value("state", "notInWar") == "notInWar")
    {
        return std::nullopt;
    }

    if (!parsed.contains("clan") || !parsed.contains("opponent"))
    {
        return std::nullopt;
    }

    CompleteClanwarData completeClanwarData;
    completeClanwarData.clanwar = Clanwar::fromJson(parsed, WarType::Regular, clanTag);
    completeClanwarData.clans = {
        ClanwarClan::fromJson(parsed["clan"], ClanType::Home),
        ClanwarClan::fromJson(parsed["opponent"], ClanType::Opponent)
    };
    completeClanwarData.attacks = ClanwarAttack::parseAttacksList(parsed);
    completeClanwarData.members = {
        ClanwarMember::parseClanwarMembers(parsed["clan"], ClanType::Home),
        ClanwarMember::parseClanwarMembers(parsed["opponent"], ClanType::Opponent)
    };

    return completeClanwarData;
}

std::optional<CompleteClanwarsLeagueData> APIClient::getCompleteClanwarsLeagueData(const std::string_view clanTag) const
{
    nlohmann::json parsed;

    try
    {
        parsed = fetchJson("/clans/" + utils::transformTag(clanTag) + "/currentwar/leaguegroup");
    }
    catch (const std::runtime_error& e)
    {
        if (const std::string errStr(e.what()); errStr.find("Not Found") != std::string::npos) return {};
        throw;
    }

    if (const std::string state = parsed.value("state", "notInWar"); state == "notInWar")
    {
        return std::nullopt;
    }

    CompleteClanwarsLeagueData completeClanwarsLeagueData;
    completeClanwarsLeagueData.clanwarsLeagueSeason = ClanwarsLeagueSeason::fromJson(parsed, clanTag);
    completeClanwarsLeagueData.clanwarsLeagueMembers = ClanwarsLeagueMember::parseClanwarsLeagueMembers(parsed);
    completeClanwarsLeagueData.warDetails = getLeagueClanwarRoundsInfo(parsed, clanTag);

    return completeClanwarsLeagueData;
}

std::vector<ClanwarsLeagueWarDetails> APIClient::getLeagueClanwarRoundsInfo(
    const nlohmann::json& parsed, const std::string_view clanTag) const
{
    if (!parsed.contains("rounds") || !parsed["rounds"].is_array()) return {};

    const auto targetClanTag = std::string(clanTag);
    std::vector<ClanwarsLeagueWarDetails> cwlWarDetails;

    for (const auto& round : parsed["rounds"])
    {
        if (!round.contains("warTags") || !round["warTags"].is_array()) continue;

        for (const auto& warTagJson : round["warTags"])
        {
            auto warTag = warTagJson.get<std::string>();
            if (warTag == "#0" || warTag.length() < 2) continue;

            nlohmann::json warParsed;
            try
            {
                warParsed = fetchJson("/clanwarleagues/wars/" + warTag);
            }
            catch (const std::exception& e)
            {
                spdlog::warn("[API] Failed to fetch CWL round {}: {}", warTag, e.what());
                continue;
            }

            std::string attackerTag = warParsed.value("/clan/tag"_json_pointer, "unknown");
            std::string defenderTag = warParsed.value("/opponent/tag"_json_pointer, "unknown");

            if (targetClanTag == attackerTag || targetClanTag == defenderTag)
            {
                ClanwarsLeagueWarDetails details;
                details.war = Clanwar::fromJson(warParsed, WarType::CWL, targetClanTag);

                if (warParsed.contains("clan"))
                    details.clans.first = ClanwarClan::fromJson(warParsed["clan"], ClanType::Home);
                if (warParsed.contains("opponent"))
                    details.clans.second = ClanwarClan::fromJson(warParsed["opponent"], ClanType::Opponent);

                details.attacks = ClanwarAttack::parseAttacksList(warParsed);
                details.members = ClanwarsLeagueMember::parseClanwarsLeagueMembers(warParsed);

                cwlWarDetails.push_back(std::move(details));
                break;
            }
        }
    }

    return cwlWarDetails;
}
