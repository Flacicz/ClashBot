//
// Created by zuevm on 29.08.2026.
//

#ifndef CLASHBOT_TELEGRAMAPICLIENT_H
#define CLASHBOT_TELEGRAMAPICLIENT_H
#include <string>

#include <nlohmann/json.hpp>

class TelegramApiClient
{
    std::string botToken;

public:
    explicit TelegramApiClient(std::string botToken);

    [[nodiscard]] bool sendMessage(
        long long chatId,
        const std::string& message,
        long long messageThreadId = 0,
        const nlohmann::json& replyMarkup = {}) const;

    [[nodiscard]] std::vector<nlohmann::json> getUpdates(long long offset, int timeout = 30) const;
};

#endif //CLASHBOT_TELEGRAMAPICLIENT_H
