#pragma once

#include <string>

struct TelegramDestination
{
    long long chatId;
    long long messageThreadId;
};

enum class Audience
{
    Players,
    Management
};

struct AudienceUtils
{
    static std::string key(const Audience audience)
    {
        switch (audience)
        {
        case Audience::Players:
            return "players";
        case Audience::Management:
            return "management";
        }

        return {};
    }
};
