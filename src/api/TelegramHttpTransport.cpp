//
// Created by zuevm on 12.09.2026.
//

#include "api/TelegramHttpTransport.h"

#include <cpr/api.h>
#include <cpr/response.h>
#include <cpr/session.h>

#include <spdlog/spdlog.h>

#include <algorithm>
#include <utility>

#include <fmt/format.h>

#include "core/Exceptions.h"

namespace
{
    std::string normalizeBaseUrl(std::string baseUrl)
    {
        if (baseUrl.empty())
        {
            return "https://api.telegram.org";
        }

        while (!baseUrl.empty() && baseUrl.back() == '/')
        {
            baseUrl.pop_back();
        }

        return baseUrl.empty() ? std::string("https://api.telegram.org") : baseUrl;
    }
}

TelegramHttpTransport::TelegramHttpTransport(std::string botToken, const TelegramHttpTransportPolicy& policy)
    : botToken_(std::move(botToken)), policy_(policy)
{
    policy_.baseUrl = normalizeBaseUrl(std::move(policy_.baseUrl));
}

void TelegramHttpTransport::requestStop() noexcept
{
    {
        std::lock_guard lock(stopMutex_);
        stopRequested_->store(true);
    }
    stopCv_.notify_all();
}

bool TelegramHttpTransport::isStopRequested() const noexcept
{
    return stopRequested_->load();
}

nlohmann::json TelegramHttpTransport::post(std::string_view method,
                                           const nlohmann::json& body,
                                           const std::optional<std::chrono::milliseconds> requestTimeout) const
{
    if (isStopRequested())
    {
        throw OperationCancelledException(
            fmt::format("Telegram {} cancelled during shutdown", method));
    }

    if (botToken_.empty())
    {
        throw ApiException(
            ApiError::UnexpectedResponse,
            "Telegram bot token is not configured");
    }

    const std::string url = fmt::format("{}/bot{}/{}", policy_.baseUrl, botToken_, method);
    const std::string requestBody = body.dump();
    const int maxAttempts = policy_.retry.maxAttempts();

    for (int attempt = 1; attempt <= maxAttempts; ++attempt)
    {
        if (isStopRequested())
        {
            throw OperationCancelledException(
                fmt::format("Telegram {} cancelled during shutdown", method));
        }

        cpr::Session session;
        session.SetUrl(cpr::Url{url});
        session.SetHeader(cpr::Header{{"Content-Type", "application/json"}});
        session.SetBody(cpr::Body{requestBody});
        session.SetTimeout(cpr::Timeout{requestTimeout.value_or(policy_.requestTimeout)});
        session.SetCancellationParam(stopRequested_);

        cpr::Response response = session.Post();

        if (isStopRequested() &&
            (response.error.code == cpr::ErrorCode::ABORTED_BY_CALLBACK ||
             response.status_code != 200))
        {
            throw OperationCancelledException(
                fmt::format("Telegram {} cancelled during shutdown", method));
        }

        const bool networkError = response.status_code == 0;
        const bool rateLimited = response.status_code == 429;
        const bool serverError =
            response.status_code >= 500 &&
            response.status_code <= 599;

        std::optional<std::chrono::seconds> telegramRetryAfter;

        if (rateLimited && !response.text.empty())
        {
            try
            {
                const auto responseJson = nlohmann::json::parse(response.text);
                const auto retryDelay = retryAfter(responseJson);

                if (retryDelay > std::chrono::seconds::zero())
                {
                    telegramRetryAfter = retryDelay;
                }
            }
            catch (const nlohmann::json::parse_error& error)
            {
                spdlog::warn(
                    "Telegram returned invalid JSON for 429 response: {}. "
                    "Using retry policy delay.",
                    error.what());
            }
        }

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
                        maxAttempts),
                    telegramRetryAfter);
            }

            auto delay = policy_.retry.delayForAttempt(attempt);

            if (telegramRetryAfter)
            {
                const auto telegramDelay = std::chrono::duration_cast<
                    std::chrono::milliseconds>(*telegramRetryAfter);

                delay = (std::max)(delay, telegramDelay);
            }

            std::unique_lock lock(stopMutex_);
            if (stopCv_.wait_for(lock, delay, [this] { return stopRequested_->load(); }))
            {
                throw OperationCancelledException(
                    fmt::format("Telegram {} retry wait cancelled during shutdown", method));
            }
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
