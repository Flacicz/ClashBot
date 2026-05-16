#ifndef ACTIVITYTRACKING_STRINGUTILS_H
#define ACTIVITYTRACKING_STRINGUTILS_H
#include <algorithm>
#include <string>

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
        return normalizedTag(std::string(tag)); // Сама делает то, что ты написал вручную
    }
}

#endif //ACTIVITYTRACKING_STRINGUTILS_H
