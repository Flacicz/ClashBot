#include "api/APIClient.h"

#include <cpr/api.h>
#include <cpr/response.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include "common/StringUtils.h"
#include "core/Exceptions.h"

using json = nlohmann::json;

APIClient::APIClient(std::string token, bool tunnel, std::string baseUrl, std::string tunnelUrl)
    : apiToken(std::move(token)),
      baseUrl(std::move(baseUrl)),
      tunnelUrl(std::move(tunnelUrl)),
      isTunnel(tunnel)
{
}

nlohmann::json APIClient::fetchJson(std::string_view endpoint) const
{
    const std::string url = (isTunnel ? tunnelUrl : baseUrl) + std::string(endpoint);

    cpr::Response response = cpr::Get(
        cpr::Url{url},
        cpr::Header{
            {"Authorization", "Bearer " + getApiToken()},
            {"Accept", "Application/json"},
        },
        cpr::VerifySsl(!getIsTunnel()),
        cpr::Timeout(std::chrono::milliseconds(20000))
    );

    if (response.error)
    {
        throw ApiException(
            ApiError::Network,
            fmt::format("[{}] Network error (endpoint = {}): {}",
                        clientName, endpoint, response.error.message)
        );
    }

    switch (response.status_code)
    {
    case 200:
        break;
    case 404:
        throw ApiException(
            ApiError::NotFound,
            fmt::format("[{}] Not found error 404 (endpoint = {}): {}",
                        clientName, endpoint, response.text)
        );
    case 429:
        throw ApiException(
            ApiError::RateLimit,
            fmt::format("[{}] Rate Limit Exceeded 429 (endpoint = {}): {}",
                        clientName, endpoint, response.text)
        );
    case 403:
        throw ApiException(
            ApiError::Forbidden,
            fmt::format("[{}] Access Denied 403 (endpoint = {}): {}",
                        clientName, endpoint, response.text)
        );
    default:
        throw ApiException(
            ApiError::UnexpectedResponse,
            fmt::format("[{}] Unexpected HTTP status {} (endpoint = {}): {}",
                        clientName, response.status_code, endpoint, response.error.message)
        );
    }

    try
    {
        auto parsed_data = json::parse(response.text);
        return parsed_data;
    }
    catch (const nlohmann::json::parse_error& e)
    {
        throw ApiException(
            ApiError::InvalidJSON,
            fmt::format("[{}] Json Parse Error (endpoint = {}): {}",
                        clientName, endpoint, e.what())
        );
    }
}

std::optional<CompleteClanData> APIClient::getCompleteClanData(const std::string_view clanTag) const
{
    nlohmann::json parsed;

    try
    {
        parsed = fetchJson("/clans/" + utils::transformTag(clanTag));
    }
    catch (const ApiException& e)
    {
        if (e.error() == ApiError::NotFound)
        {
            return std::nullopt;
        }
        throw;
    }

    if (!parsed.contains("tag") || !parsed.contains("memberList") || !parsed["memberList"].is_array())
    {
        throw ApiException(
            ApiError::UnexpectedResponse,
            fmt::format(
                "[{}] Invalid response for clan (clan_tag = {})",
                clientName,
                clanTag));
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
    catch (const ApiException& e)
    {
        if (e.error() == ApiError::NotFound)
        {
            return std::nullopt;
        }
        throw;
    }

    if (!parsed.contains("items") || !parsed["items"].is_array() || parsed["items"].empty())
    {
        throw ApiException(
            ApiError::UnexpectedResponse,
            fmt::format(
                "[{}] Invalid raid response for clan (clan_tag = {})",
                clientName,
                clanTag));
    }

    const auto& part = parsed["items"][0];

    if (const std::string state = part.value("state", ""); state == "scheduled")
    {
        return std::nullopt;
    }

    if (!part.contains("members") || !part["members"].is_array())
    {
        throw ApiException(
            ApiError::UnexpectedResponse,
            fmt::format(
                "[{}] Invalid raid response for clan (clan_tag = {})",
                clientName,
                clanTag));
    }

    CompleteRaidData completeRaidData;
    completeRaidData.clanRaid = ClanRaid::fromJson(part, clanTag);
    completeRaidData.playerRaidSnapshots = PlayerRaidSnapshot::fromJson(part["members"]);

    return completeRaidData;
}

ClanwarsFetchResult APIClient::getCompleteClanwarData(const std::string_view clanTag) const
{
    nlohmann::json parsed;
    try
    {
        parsed = fetchJson("/clans/" + utils::transformTag(clanTag) + "/currentwar");
    }
    catch (const ApiException& e)
    {
        const std::string errStr(e.what());

        return {ClanwarFetchStatus::Error, std::nullopt, errStr};
    }

    if (parsed.value("state", "notInWar") == "notInWar")
    {
        return {ClanwarFetchStatus::NoActiveWar};
    }

    if (!parsed.contains("clan") || !parsed.contains("opponent"))
    {
        return {
            ClanwarFetchStatus::Error,
            std::nullopt,
            fmt::format(
                "[{}] Invalid clanwar response for clan (clan_tag = {})",
                clientName,
                clanTag)
        };
    }

    CompleteClanwarData completeClanwarData;
    completeClanwarData.clanwar = Clanwar::fromJson(parsed, WarType::Regular, clanTag);
    completeClanwarData.clans = {
        ClanwarClan::fromJson(parsed["clan"], ClanType::Home),
        ClanwarClan::fromJson(parsed["opponent"], ClanType::Opponent)
    };
    completeClanwarData.attacks = ClanwarAttack::parseAttacksList(parsed);
    completeClanwarData.members = {
        ClanwarMember::parseClanwarMembers(parsed["clan"]),
        ClanwarMember::parseClanwarMembers(parsed["opponent"])
    };

    return {ClanwarFetchStatus::Success, completeClanwarData};
}

ClanwarsLeagueFetchResult APIClient::getCompleteClanwarsLeagueData(const std::string_view clanTag) const
{
    nlohmann::json parsed;

    try
    {
        parsed = fetchJson("/clans/" + utils::transformTag(clanTag) + "/currentwar/leaguegroup");
    }
    catch (const ApiException& e)
    {
        const std::string errStr(e.what());

        if (e.error() == ApiError::NotFound)
        {
            return {LeagueFetchStatus::NoActiveLeague};
        }

        return {LeagueFetchStatus::Error, std::nullopt, errStr};
    }

    if (const std::string state = parsed.value("state", "notInWar"); state == "notInWar")
    {
        return {LeagueFetchStatus::NoActiveLeague};
    }

    if (!parsed.contains("season") || !parsed.contains("rounds"))
    {
        return {
            LeagueFetchStatus::Error,
            std::nullopt,
            fmt::format(
                "[{}] Invalid CWL response for clan (clan_tag = {})",
                clientName,
                clanTag)
        };
    }

    CompleteClanwarsLeagueData completeClanwarsLeagueData;
    completeClanwarsLeagueData.clanwarsLeagueSeason = ClanwarsLeagueSeason::fromJson(parsed, clanTag);
    completeClanwarsLeagueData.clanwarsLeagueMembers = ClanwarsLeagueMember::parseClanwarsLeagueMembers(parsed);
    completeClanwarsLeagueData.warDetails = getLeagueClanwarRoundsInfo(parsed, clanTag);

    return {LeagueFetchStatus::Success, std::move(completeClanwarsLeagueData)};
}

std::vector<CompleteClanwarData> APIClient::getLeagueClanwarRoundsInfo(
    const nlohmann::json& parsed, const std::string_view clanTag) const
{
    if (!parsed.contains("rounds") || !parsed["rounds"].is_array()) return {};

    const auto targetClanTag = std::string(clanTag);
    std::vector<CompleteClanwarData> cwlWarDetails;

    for (const auto& round : parsed["rounds"])
    {
        if (!round.contains("warTags") || !round["warTags"].is_array()) continue;

        for (const auto& warTagJson : round["warTags"])
        {
            const auto warTag = warTagJson.get<std::string>();
            if (warTag == "#0" || warTag.length() < 2) continue;

            nlohmann::json warParsed;
            try
            {
                warParsed = fetchJson("/clanwarleagues/wars/" + utils::transformTag(warTag));
            }
            catch (const ApiException& e)
            {
                if (e.error() == ApiError::NotFound)
                    continue;

                throw;
            }

            if (!warParsed.contains("clan") ||
                !warParsed.contains("opponent"))
            {
                throw ApiException(
                    ApiError::UnexpectedResponse,
                    fmt::format(
                        "[{}] Invalid CWL war response (war_tag = {}, clan_tag = {})",
                        clientName,
                        warTag,
                        clanTag));
            }

            std::string attackerTag = warParsed.value("/clan/tag"_json_pointer, "unknown");
            std::string defenderTag = warParsed.value("/opponent/tag"_json_pointer, "unknown");

            if (targetClanTag == attackerTag || targetClanTag == defenderTag)
            {
                CompleteClanwarData details;
                details.clanwar = Clanwar::fromJson(warParsed, WarType::CWL, targetClanTag);

                if (warParsed.contains("clan") && warParsed.contains("opponent"))
                {
                    if (attackerTag == targetClanTag)
                    {
                        details.clans.first = ClanwarClan::fromJson(warParsed["clan"], ClanType::Home);
                        details.clans.second = ClanwarClan::fromJson(warParsed["opponent"], ClanType::Opponent);

                        details.members.first = ClanwarMember::parseClanwarMembers(warParsed["clan"]);
                        details.members.second = ClanwarMember::parseClanwarMembers(warParsed["opponent"]);
                    }
                    else
                    {
                        details.clans.first = ClanwarClan::fromJson(warParsed["opponent"], ClanType::Home);
                        details.clans.second = ClanwarClan::fromJson(warParsed["clan"], ClanType::Opponent);

                        details.members.first = ClanwarMember::parseClanwarMembers(warParsed["opponent"]);
                        details.members.second = ClanwarMember::parseClanwarMembers(warParsed["clan"]);
                    }
                }

                details.attacks = ClanwarAttack::parseAttacksList(warParsed);

                cwlWarDetails.push_back(std::move(details));
                break;
            }
        }
    }

    return cwlWarDetails;
}
