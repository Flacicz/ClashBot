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

    struct AttackStrategy
    {
        std::string id;
        std::string title;
    };

    struct AttackGuide
    {
        std::string id;
        std::string armyId;
        std::string armyTitle;
        std::string variantId;
        std::string variantTitle;
        std::string title;
        std::vector<int> townHalls;
        std::string youtubeUrl;
        int sortOrder = 0;
        bool enabled = true;
    };
}

#endif //CLASHBOT_TELEGRAMMODELS_H
