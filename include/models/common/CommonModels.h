#pragma once

#include <string>

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
