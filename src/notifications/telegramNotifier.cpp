#include "notifications/telegramNotifier.h"

#include <cpr/api.h>
#include <cpr/response.h>
#include <nlohmann/json.hpp>
#include <nlohmann/json_fwd.hpp>
#include <spdlog/spdlog.h>

TelegramNotifier::TelegramNotifier(std::string token)
    : botToken(std::move(token))
{
}

bool TelegramNotifier::sendMessage(const std::string& message, long long chatId) const
{
    if (botToken.empty())
    {
        spdlog::warn(
            "[Telegram] Bot token is not configured. Message to chat {} was not sent.",
            chatId);
        return false;
    }


    const std::string url = "https://api.telegram.org/bot" + botToken + "/sendMessage";

    const nlohmann::json jsonBody = {
        {"chat_id", chatId},
        {"text", message},
        {"parse_mode", "HTML"}
    };

    cpr::Response response = cpr::Post(
        cpr::Url{url},
        cpr::Header{{"Content-Type", "application/json"}},
        cpr::Body{jsonBody.dump()}
    );

    if (response.status_code == 200)
    {
        spdlog::debug(
            "[Telegram] Message sent successfully to chat {}.",
            chatId);
        return true;
    }

    if (response.status_code == 0)
    {
        spdlog::error(
            "[Telegram] Failed to send message to chat {}. Network error: {}",
            chatId,
            response.error.message);

        return false;
    }

    spdlog::error(
        "[Telegram] Failed to send message to chat {}. HTTP {}: {}",
        chatId,
        response.status_code,
        response.text);

    return false;
}
