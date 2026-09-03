#include "telegram/TelegramValidation.h"

#include <charconv>

namespace telegram
{
    std::optional<int> parseTownHall(const std::string_view value)
    {
        if (value.empty())
        {
            return std::nullopt;
        }

        int townHall = 0;

        const auto [end, error] = std::from_chars(
            value.data(),
            value.data() + value.size(),
            townHall);

        if (error != std::errc{} ||
            end != value.data() + value.size())
        {
            return std::nullopt;
        }

        if (townHall < 7 || townHall > 18)
        {
            return std::nullopt;
        }

        return townHall;
    }
}
