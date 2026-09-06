//
// Created by zuevm on 29.08.2026.
//

#include "api/TelegramApiClient.h"

#include "core/Exceptions.h"

#include <nlohmann/json_fwd.hpp>

#include <utility>
#include <cpr/api.h>
#include <cpr/response.h>

TelegramApiClient::TelegramApiClient(std::string botToken) : botToken(std::move(botToken))
{
}

void TelegramApiClient::sendMessage(long long chatId, const std::string& message, long long messageThreadId,
                                    const nlohmann::json& replyMarkup) const
{
    if (botToken.empty())
    {
        throw ApiException(
            ApiError::UnexpectedResponse,
            "Telegram bot token is not configured");
    }

    const std::string url = "https://api.telegram.org/bot" + botToken + "/sendMessage";

    nlohmann::json jsonBody = {
        {"chat_id", chatId},
        {"text", message},
        {"parse_mode", "HTML"}
    };

    if (messageThreadId != 0)
    {
        jsonBody["message_thread_id"] = messageThreadId;
    }

    if (!replyMarkup.empty())
    {
        jsonBody["reply_markup"] = replyMarkup;
    }

    cpr::Response response = cpr::Post(
        cpr::Url{url},
        cpr::Header{{"Content-Type", "application/json"}},
        cpr::Body{jsonBody.dump()}
    );

    if (response.status_code == 0)
    {
        throw ApiException(
            ApiError::Network,
            std::string("Telegram network error: ") + response.error.message);
    }

    try
    {
        const auto responseJson = nlohmann::json::parse(response.text);

        if (response.status_code == 200 &&
            responseJson.value("ok", false))
        {
            return;
        }

        const auto description =
            responseJson.value("description", std::string("Unknown Telegram API error"));

        throw ApiException(
            ApiError::UnexpectedResponse,
            std::string("Telegram sendMessage failed: ") + description);
    }
    catch (const nlohmann::json::parse_error& error)
    {
        throw ApiException(
            ApiError::InvalidJSON,
            std::string("Invalid Telegram sendMessage response: ") + error.what());
    }
}

void TelegramApiClient::editMessageText(long long chatId,
                                        long long messageId,
                                        const std::string& text,
                                        const nlohmann::json& replyMarkup) const
{
    if (botToken.empty())
    {
        throw ApiException(
            ApiError::UnexpectedResponse,
            "Telegram bot token is not configured");
    }

    const std::string url =
        "https://api.telegram.org/bot" + botToken + "/editMessageText";

    nlohmann::json jsonBody = {
        {"chat_id", chatId},
        {"message_id", messageId},
        {"text", text},
        {"parse_mode", "HTML"}
    };

    if (!replyMarkup.empty())
    {
        jsonBody["reply_markup"] = replyMarkup;
    }

    const cpr::Response response = cpr::Post(
        cpr::Url{url},
        cpr::Header{{"Content-Type", "application/json"}},
        cpr::Body{jsonBody.dump()}
    );

    if (response.status_code == 0)
    {
        throw ApiException(
            ApiError::Network,
            std::string("Telegram network error: ") + response.error.message);
    }

    try
    {
        const auto responseJson = nlohmann::json::parse(response.text);

        if (response.status_code == 200 &&
            responseJson.value("ok", false))
        {
            return;
        }

        const auto description =
            responseJson.value("description", std::string("Unknown Telegram API error"));

        throw ApiException(
            ApiError::UnexpectedResponse,
            std::string("Telegram editMessageText failed: ") + description);
    }
    catch (const nlohmann::json::parse_error& error)
    {
        throw ApiException(
            ApiError::InvalidJSON,
            std::string("Invalid Telegram editMessageText response: ") + error.what());
    }
}

std::vector<nlohmann::json> TelegramApiClient::getUpdates(long long offset, int timeout) const
{
    if (botToken.empty())
    {
        throw ApiException(
            ApiError::UnexpectedResponse,
            "Telegram bot token is not configured");
    }

    const std::string url = "https://api.telegram.org/bot" + botToken + "/getUpdates";

    nlohmann::json jsonBody = {
        {"offset", offset},
        {"timeout", timeout},
        {"allowed_updates", {"message", "callback_query"}}
    };

    cpr::Response response = cpr::Post(
        cpr::Url{url},
        cpr::Header{{"Content-Type", "application/json"}},
        cpr::Body{jsonBody.dump()}
    );

    if (response.status_code == 0)
    {
        throw ApiException(
            ApiError::Network,
            std::string("Telegram network error: ") + response.error.message);
    }

    try
    {
        const auto responseJson = nlohmann::json::parse(response.text);

        if (response.status_code != 200)
        {
            throw ApiException(
                ApiError::UnexpectedResponse,
                std::string("Telegram getUpdates failed with HTTP ") +
                std::to_string(response.status_code) + ": " +
                responseJson.value("description", std::string("Unknown HTTP error")));
        }

        if (!responseJson.value("ok", false))
        {
            throw ApiException(
                ApiError::UnexpectedResponse,
                std::string("Telegram getUpdates failed: ") +
                responseJson.value("description", std::string("Unknown Telegram API error")));
        }

        return responseJson.at("result").get<std::vector<nlohmann::json>>();
    }
    catch (const nlohmann::json::exception& error)
    {
        throw ApiException(
            ApiError::InvalidJSON,
            std::string("Invalid Telegram getUpdates response: ") + error.what());
    }
}

void TelegramApiClient::answerCallbackQuery(const std::string& callbackQueryId) const
{
    if (botToken.empty())
    {
        throw ApiException(
            ApiError::UnexpectedResponse,
            "Telegram bot token is not configured");
    }

    const std::string url =
        "https://api.telegram.org/bot" + botToken + "/answerCallbackQuery";

    const nlohmann::json jsonBody = {
        {"callback_query_id", callbackQueryId}
    };

    const cpr::Response response = cpr::Post(
        cpr::Url{url},
        cpr::Header{{"Content-Type", "application/json"}},
        cpr::Body{jsonBody.dump()}
    );

    if (response.status_code == 0)
    {
        throw ApiException(
            ApiError::Network,
            std::string("Telegram network error: ") + response.error.message);
    }

    try
    {
        const auto responseJson = nlohmann::json::parse(response.text);

        if (response.status_code == 200 &&
            responseJson.value("ok", false))
        {
            return;
        }

        const auto description =
            responseJson.value("description", std::string("Unknown Telegram API error"));

        throw ApiException(
            ApiError::UnexpectedResponse,
            std::string("Telegram answerCallbackQuery failed: ") + description);
    }
    catch (const nlohmann::json::parse_error& error)
    {
        throw ApiException(
            ApiError::InvalidJSON,
            std::string("Invalid Telegram answerCallbackQuery response: ") + error.what());
    }
}

nlohmann::json TelegramApiClient::getChatMember(
    const long long chatId,
    const long long userId) const
{
    if (botToken.empty())
    {
        throw ApiException(
            ApiError::UnexpectedResponse,
            "Telegram bot token is not configured");
    }

    const std::string url =
        "https://api.telegram.org/bot" + botToken + "/getChatMember";

    const nlohmann::json requestBody = {
        {"chat_id", chatId},
        {"user_id", userId}
    };

    const cpr::Response response = cpr::Post(
        cpr::Url{url},
        cpr::Header{{"Content-Type", "application/json"}},
        cpr::Body{requestBody.dump()}
    );

    if (response.status_code == 0)
    {
        throw ApiException(
            ApiError::Network,
            std::string("Telegram network error: ") + response.error.message);
    }

    try
    {
        const auto responseJson = nlohmann::json::parse(response.text);

        if (response.status_code == 200 &&
            responseJson.value("ok", false))
        {
            return responseJson.at("result");
        }

        throw ApiException(
            ApiError::UnexpectedResponse,
            std::string("Telegram getChatMember failed: ") +
            responseJson.value(
                "description",
                std::string("Unknown Telegram API error")));
    }
    catch (const nlohmann::json::exception& error)
    {
        throw ApiException(
            ApiError::InvalidJSON,
            std::string("Invalid Telegram getChatMember response: ") + error.what());
    }
}
