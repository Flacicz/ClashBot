//
// Created by zuevm on 31.08.2026.
//

#ifndef CLASHBOT_TELEGRAMMODELS_H
#define CLASHBOT_TELEGRAMMODELS_H

#include <string>
#include <vector>

namespace telegram
{
    struct TelegramDestination
    {
        long long chatId;
        long long messageThreadId;
    };

    struct CallbackData
    {
        std::string command;
        std::vector<std::string> arguments;
    };

    struct CallbackContext
    {
        std::string queryId;
        std::string data;
        long long chatId;
        long long messageId;
    };

    struct AttackGuide
    {
        int townHall;
        std::string id;
        std::string title;
        std::string videoFileId;
    };
}

#endif //CLASHBOT_TELEGRAMMODELS_H
