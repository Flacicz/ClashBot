//
// Created by zuevm on 29.08.2026.
//

#include "api/TelegramApiClient.h"

#include <nlohmann/json_fwd.hpp>

#include <utility>
#include <cpr/api.h>
#include <cpr/response.h>
#include <spdlog/spdlog.h>

TelegramApiClient::TelegramApiClient(std::string botToken) : botToken(std::move(botToken))
{
}

bool TelegramApiClient::sendMessage(long long chatId, const std::string& message, long long messageThreadId,
                                    const nlohmann::json& replyMarkup) const
{
    if (botToken.empty())
    {
        spdlog::warn(
            "[Telegram] Bot token is not configured. Message to chat {} was not sent.",
            chatId);
        return false;
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
        spdlog::error(
            "[Telegram] Network error: {}",
            response.error.message);
        return false;
    }

    try
    {
        const auto responseJson = nlohmann::json::parse(response.text);

        if (response.status_code == 200 &&
            responseJson.value("ok", false))
        {
            spdlog::debug(
                "[Telegram] Message sent successfully to chat {}.",
                chatId);
            return true;
        }

        if (!responseJson.value("ok", false))
        {
            spdlog::error(
                "[Telegram] API request failed for chat {}. HTTP {}: {}",
                chatId,
                response.status_code,
                responseJson.value("description", "Unknown Telegram API error"));
        }
    }
    catch (const nlohmann::json::parse_error& error)
    {
        spdlog::error("[Telegram] Invalid response JSON: {}", error.what());
    }

    return false;
}
