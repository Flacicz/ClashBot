//
// Created by zuevm on 29.08.2026.
//

#ifndef CLASHBOT_TELEGRAMBOTSERVICE_H
#define CLASHBOT_TELEGRAMBOTSERVICE_H
#include <mutex>

#include "api/TelegramApiClient.h"

class TelegramBotService
{
private:
    TelegramApiClient& telegram_api_client_;

public:
    explicit TelegramBotService(TelegramApiClient& telegramApi);

    void updateLoop() const;
    void stopLoop();

    void processUpdate(const nlohmann::json& update) const;
    void handleMessage(const nlohmann::json& update) const;

    void sendStartMenu(long long chatId) const;

private:
    std::mutex mutex_;
    std::condition_variable cv_;
    std::atomic<bool> running_{true};
};

#endif //CLASHBOT_TELEGRAMBOTSERVICE_H
