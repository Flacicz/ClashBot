#pragma once

#include <string>

class TelegramNotifier {
    std::string botToken;
public:
    explicit TelegramNotifier(std::string  token);

    [[nodiscard]] bool sendMessage(const std::string& message, long long chatId) const;
};
