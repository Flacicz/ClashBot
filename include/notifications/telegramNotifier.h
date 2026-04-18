#pragma once

#include <string>

class TelegramNotifier {
private:
    std::string botToken;
    std::string chatId;
public:
    TelegramNotifier(const std::string& token, const std::string& chat_id);

    bool sendMessage(const std::string& message);
};
