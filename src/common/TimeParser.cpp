#include "common/TimeParser.h"

#include <nlohmann/json.hpp>

std::string extractTime(const nlohmann::json& j, const std::string_view key)
{
    if (!j.contains(key)) return {};

    const std::string time = j.value(std::string(key), "00000000T00000");

    if (time == "00000000T00000") return {};

    return time.substr(0, time.find_first_of('.'));
}

long long parseISOToUnix(const std::string_view iso)
{
    std::istringstream ss{std::string(iso)};
    std::chrono::sys_seconds tp;
    ss >> std::chrono::parse("%Y%m%dT%H%M%S", tp);

    if (ss.fail()) return 0;

    return tp.time_since_epoch().count();
}