#pragma once

#include <string>

class TelegramNotifier {
private:
    std::string botToken;
    std::string chatId;
public:
    TelegramNotifier(std::string  token, std::string  chatId);

    bool sendMessage(const std::string& message);
};
