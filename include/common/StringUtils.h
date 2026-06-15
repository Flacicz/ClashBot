#ifndef ACTIVITYTRACKING_STRINGUTILS_H
#define ACTIVITYTRACKING_STRINGUTILS_H
#include <algorithm>
#include <string>

#include "spdlog/fmt/bundled/chrono.h"

namespace utils
{
    inline void normalizeTag(std::string& tag)
    {
        std::ranges::transform(tag, tag.begin(),
                               [](const unsigned char c) { return std::tolower(c); });
    }

    [[nodiscard]] inline std::string normalizedTag(std::string tag) {
        normalizeTag(tag);
        return tag;
    }
    [[nodiscard]] inline std::string normalizedTag(const std::string_view tag) {
        return normalizedTag(std::string(tag));
    }

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
