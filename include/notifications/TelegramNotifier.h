#pragma once

#include <string>

#include "api/TelegramApiClient.h"

class TelegramNotifier
{
    TelegramApiClient& telegram_api_client_;

public:
    explicit TelegramNotifier(TelegramApiClient& telegram_api_client);

    void sendMessage(
        long long chatId,
        const std::string& message,
        long long messageThreadId = 0) const;
};
