#include "common/TimeParser.h"

#include <nlohmann/json.hpp>
#include <chrono>
#include <cctype>

#include <fmt/chrono.h>
#include <iomanip>
#include <sstream>

namespace
{
    constexpr std::string_view UnknownApiTime = "00000000T00000";
}

std::string utils::extractTime(const nlohmann::json& j, const std::string_view key)
{
    const std::string time = j.value(
        std::string(key),
        std::string{}
    );

    if (time.empty() || time == UnknownApiTime) return {};

    return time.substr(0, time.find_first_of('.'));
}

long long utils::parseISOToUnix(const std::string_view iso)
{
    std::string value(iso);

    if (!value.empty() && value.back() == 'Z')
    {
        value.pop_back();
    }

    const auto dot = value.find('.');
    if (dot != std::string::npos)
    {
        if (dot != 15 || dot + 1 == value.size())
        {
            return 0;
        }

        for (std::size_t i = dot + 1; i < value.size(); ++i)
        {
            if (!std::isdigit(static_cast<unsigned char>(value[i])))
            {
                return 0;
            }
        }

        value.resize(dot);
    }

    if (value.size() != 15 || value[8] != 'T')
    {
        return 0;
    }

    std::tm tm{};
    std::istringstream stream(value);
    stream >> std::get_time(&tm, "%Y%m%dT%H%M%S");

    if (stream.fail() || stream.peek() != std::char_traits<char>::eof())
    {
        return 0;
    }

    const std::chrono::year_month_day date{
        std::chrono::year{tm.tm_year + 1900},
        std::chrono::month{static_cast<unsigned>(tm.tm_mon + 1)},
        std::chrono::day{static_cast<unsigned>(tm.tm_mday)}
    };

    if (tm.tm_year < -1899 ||
        tm.tm_hour < 0 || tm.tm_hour > 23 ||
        tm.tm_min < 0 || tm.tm_min > 59 ||
        tm.tm_sec < 0 || tm.tm_sec > 59 ||
        !date.ok())
    {
        return 0;
    }

    const auto timestamp = std::chrono::sys_days{date}
        + std::chrono::hours{tm.tm_hour}
        + std::chrono::minutes{tm.tm_min}
        + std::chrono::seconds{tm.tm_sec};

    return std::chrono::duration_cast<std::chrono::seconds>(
        timestamp.time_since_epoch()
    ).count();
}

std::string utils::formatUnixToLocalDateTime(const long long timestamp)
{
    if (timestamp <= 0)
    {
        return "неизвестно";
    }

    const auto moscowTimestamp = timestamp + 3 * 60 * 60;

    return fmt::format(
        "{:%d.%m.%Y %H:%M}",
        fmt::gmtime(moscowTimestamp)
    );
}
