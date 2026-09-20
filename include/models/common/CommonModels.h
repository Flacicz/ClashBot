#pragma once

#include <optional>
#include <string>
#include <string_view>

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

    static std::optional<Audience> fromKey(const std::string_view value)
    {
        if (value == "players")
            return Audience::Players;

        if (value == "management")
            return Audience::Management;

        return std::nullopt;
    }
};
