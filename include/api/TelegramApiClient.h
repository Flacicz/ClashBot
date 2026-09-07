//
// Created by zuevm on 29.08.2026.
//

#ifndef CLASHBOT_TELEGRAMAPICLIENT_H
#define CLASHBOT_TELEGRAMAPICLIENT_H
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

class TelegramApiClient
{
    std::string botToken;

public:
    explicit TelegramApiClient(std::string botToken);
    virtual ~TelegramApiClient() = default;

    virtual void sendMessage(
        long long chatId,
        const std::string& message,
        long long messageThreadId = 0,
        const nlohmann::json& replyMarkup = {}) const;

    virtual void editMessageText(
        long long chatId,
        long long messageId,
        const std::string& text,
        const nlohmann::json& replyMarkup = {}) const;

    virtual void answerCallbackQuery(
        const std::string& callbackQueryId) const;

    [[nodiscard]] virtual nlohmann::json getChatMember(
        long long chatId,
        long long userId) const;

    [[nodiscard]] virtual std::vector<nlohmann::json> getUpdates(
        long long offset,
        int timeout = 30) const;
};

#endif //CLASHBOT_TELEGRAMAPICLIENT_H
