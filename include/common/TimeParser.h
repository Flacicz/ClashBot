#ifndef CLASHBOT_TIMEPARSER_H
#define CLASHBOT_TIMEPARSER_H
#include <string>
#include <string_view>
#include <nlohmann/json_fwd.hpp>

namespace utils
{
    std::string extractTime(const nlohmann::json& j, std::string_view key);
    long long parseISOToUnix(std::string_view iso);
}


#endif //CLASHBOT_TIMEPARSER_H
