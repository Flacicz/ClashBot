//
// Created by zuevm on 29.08.2026.
//

#include "api/TelegramApiClient.h"

#include "core/Exceptions.h"

#include <algorithm>
#include <chrono>

TelegramApiClient::TelegramApiClient(TelegramHttpTransport& telegramHttpTransport)
    : telegramHttpTransport(telegramHttpTransport)
{
}

void TelegramApiClient::sendMessage(long long chatId, const std::string& message, long long messageThreadId,
                                    const nlohmann::json& replyMarkup) const
{
    nlohmann::json jsonBody = {
        {"chat_id", chatId},
        {"text", message},
        {"parse_mode", "HTML"}
    };

    if (messageThreadId != 0) jsonBody["message_thread_id"] = messageThreadId;

    if (!replyMarkup.empty()) jsonBody["reply_markup"] = replyMarkup;

    telegramHttpTransport.post("sendMessage", jsonBody);
}

void TelegramApiClient::editMessageText(long long chatId,
                                        long long messageId,
                                        const std::string& text,
                                        const nlohmann::json& replyMarkup) const
{
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

    telegramHttpTransport.post("editMessageText", jsonBody);
}

std::vector<nlohmann::json> TelegramApiClient::getUpdates(long long offset, int timeout) const
{
    nlohmann::json jsonBody = {
        {"offset", offset},
        {"timeout", timeout},
        {"allowed_updates", {"message", "callback_query"}}
    };

    // The HTTP timeout must exceed Telegram's long-polling timeout.
    const auto requestTimeout = std::chrono::duration_cast<
        std::chrono::milliseconds>(
            std::chrono::seconds(std::max(10, timeout + 5)));

    const auto responseJson = telegramHttpTransport.post(
        "getUpdates",
        jsonBody,
        requestTimeout);

    try
    {
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
    const nlohmann::json jsonBody = {
        {"callback_query_id", callbackQueryId}
    };

    telegramHttpTransport.post("answerCallbackQuery", jsonBody);
}

nlohmann::json TelegramApiClient::getChatMember(
    const long long chatId,
    const long long userId) const
{
    const nlohmann::json requestBody = {
        {"chat_id", chatId},
        {"user_id", userId}
    };

    const auto responseJson = telegramHttpTransport.post(
        "getChatMember",
        requestBody);

    try
    {
        return responseJson.at("result");
    }
    catch (const nlohmann::json::exception& error)
    {
        throw ApiException(
            ApiError::InvalidJSON,
            std::string("Invalid Telegram getChatMember response: ") + error.what());
    }
}
