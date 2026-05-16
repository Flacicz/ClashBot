#ifndef ACTIVITYTRACKING_TIMEPARSER_H
#define ACTIVITYTRACKING_TIMEPARSER_H
#include <string>
#include <string_view>
#include <nlohmann/json_fwd.hpp>

namespace utils
{
    std::string extractTime(const nlohmann::json& j, std::string_view key);
    long long parseISOToUnix(std::string_view iso);
}


#endif //ACTIVITYTRACKING_TIMEPARSER_H
