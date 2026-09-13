//
// Created by zuevm on 12.09.2026.
//

#include "api/TelegramHttpTransport.h"

#include <cpr/api.h>
#include <cpr/response.h>

#include <spdlog/spdlog.h>

#include <algorithm>
#include <thread>
#include <utility>

#include <fmt/format.h>

#include "core/Exceptions.h"

TelegramHttpTransport::TelegramHttpTransport(std::string botToken, const TelegramHttpTransportPolicy& policy)
    : botToken_(std::move(botToken)), policy_(policy)
{
}

nlohmann::json TelegramHttpTransport::post(std::string_view method,
                                           const nlohmann::json& body,
                                           const std::optional<std::chrono::milliseconds> requestTimeout) const
{
    if (botToken_.empty())
    {
        throw ApiException(
            ApiError::UnexpectedResponse,
            "Telegram bot token is not configured");
    }

    const std::string url = fmt::format("https://api.telegram.org/bot{}/{}", botToken_, method);
    const std::string requestBody = body.dump();
    const int maxAttempts = policy_.retry.maxAttempts();

    for (int attempt = 1; attempt <= maxAttempts; ++attempt)
    {
        cpr::Response response = cpr::Post(
            cpr::Url{url},
            cpr::Header{{"Content-Type", "application/json"}},
            cpr::Body{requestBody},
            cpr::Timeout{requestTimeout.value_or(policy_.requestTimeout)}
        );

        const bool networkError = response.status_code == 0;
        const bool rateLimited = response.status_code == 429;
        const bool serverError =
            response.status_code >= 500 &&
            response.status_code <= 599;

        if (networkError || rateLimited || serverError)
        {
            if (attempt == maxAttempts)
            {
                const auto error = rateLimited
                                       ? ApiError::RateLimit
                                       : serverError
                                       ? ApiError::UnexpectedResponse
                                       : ApiError::Network;

                throw ApiException(
                    error,
                    fmt::format(
                        "Telegram {} failed after {} attempts",
                        method,
                        maxAttempts));
            }

            auto delay = policy_.retry.delayForAttempt(attempt);

            if (rateLimited && !response.text.empty())
            {
                try
                {
                    const auto responseJson = nlohmann::json::parse(response.text);
                    const auto telegramDelay = std::chrono::duration_cast<
                        std::chrono::milliseconds>(retryAfter(responseJson));

                    delay = max(delay, telegramDelay);
                }
                catch (const nlohmann::json::parse_error& error)
                {
                    spdlog::warn(
                        "Telegram returned invalid JSON for 429 response: {}. "
                        "Using retry policy delay.",
                        error.what());
                }
            }

            std::this_thread::sleep_for(delay);
            continue;
        }

        try
        {
            const auto responseJson = nlohmann::json::parse(response.text);

            if (response.status_code == 200 &&
                responseJson.is_object() &&
                responseJson.value("ok", false))
            {
                return responseJson;
            }

            const auto description = responseJson.is_object()
                                         ? responseJson.value(
                                             "description",
                                             std::string("Unknown Telegram API error"))
                                         : std::string("Telegram returned non-object JSON");

            throw ApiException(
                ApiError::UnexpectedResponse,
                fmt::format(
                    "Telegram {} failed: {}",
                    method,
                    description));
        }
        catch (const nlohmann::json::parse_error& error)
        {
            throw ApiException(
                ApiError::InvalidJSON,
                fmt::format(
                    "Invalid Telegram {} response: {}",
                    method,
                    error.what()));
        }
    }

    throw ApiException(
        ApiError::Network,
        fmt::format("Telegram {} failed without a response", method));
}

std::chrono::seconds TelegramHttpTransport::retryAfter(const nlohmann::json& responseJson)
{
    if (!responseJson.is_object())
    {
        return std::chrono::seconds::zero();
    }

    const auto parametersIt = responseJson.find("parameters");
    if (parametersIt == responseJson.end() || !parametersIt->is_object())
    {
        return std::chrono::seconds::zero();
    }

    const auto retryAfterIt = parametersIt->find("retry_after");
    if (retryAfterIt == parametersIt->end() ||
        !retryAfterIt->is_number_integer())
    {
        return std::chrono::seconds::zero();
    }

    const auto seconds = retryAfterIt->get<long long>();
    return seconds > 0
               ? std::chrono::seconds(seconds)
               : std::chrono::seconds::zero();
}
