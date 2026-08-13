#include "common/TimeParser.h"

#include <nlohmann/json.hpp>
#include <chrono>
#include <iomanip>
#include <sstream>

#include <fmt/chrono.h>

std::string utils::extractTime(const nlohmann::json& j, const std::string_view key)
{
    if (!j.contains(key)) return {};

    const std::string time = j.value(std::string(key), "00000000T00000");

    if (time == "00000000T00000") return {};

    return time.substr(0, time.find_first_of('.'));
}

long long utils::parseISOToUnix(const std::string_view iso)
{
    std::string value(iso);

    if (const auto dot = value.find('.'); dot != std::string::npos)
    {
        value.resize(dot);
    }

    if (!value.empty() && value.back() == 'Z')
    {
        value.pop_back();
    }

    std::tm tm{};
    std::istringstream ss(value);
    ss >> std::get_time(&tm, "%Y%m%dT%H%M%S");

    if (ss.fail()) return 0;

#ifdef _WIN32
    const auto timestamp = _mkgmtime(&tm);
#else
    const auto timestamp = timegm(&tm);
#endif

    return timestamp == -1 ? 0 : static_cast<long long>(timestamp);
}

std::string utils::formatUnixToLocalDateTime(const long long timestamp)
{
    if (timestamp <= 0) return "неизвестно";

    const auto utcTime = std::chrono::system_clock::from_time_t(timestamp);

    const auto moscowTime = utcTime + std::chrono::hours{3};

    return fmt::format(
        "{:%d.%m.%Y %H:%M}",
        moscowTime);
}
