#ifndef ACTIVITYTRACKING_STRINGUTILS_H
#define ACTIVITYTRACKING_STRINGUTILS_H
#include <algorithm>
#include <string>

#include "spdlog/fmt/bundled/chrono.h"

namespace utils
{
    inline std::string transformTag(const std::string_view tag)
    {
        if (tag.empty()) return "";
        return tag.front() == '#' ? "%23" + std::string(tag.substr(1)) : "%23" + std::string(tag);
    }

    inline std::string getCurrentDateString() {
        const auto now = std::chrono::system_clock::now();
        return fmt::format("{:%Y-%m-%d}", fmt::localtime(now));
    }
}

#endif //ACTIVITYTRACKING_STRINGUTILS_H
