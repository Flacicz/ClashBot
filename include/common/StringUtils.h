#ifndef CLASHBOT_STRINGUTILS_H
#define CLASHBOT_STRINGUTILS_H
#include <string>
#include <chrono>
#include <fmt/chrono.h>

namespace utils
{
    inline std::string transformTag(const std::string_view tag)
    {
        if (tag.empty()) return "";
        return tag.front() == '#' ? "%23" + std::string(tag.substr(1)) : "%23" + std::string(tag);
    }

    inline std::string getCurrentDateString()
    {
        auto now = std::chrono::system_clock::now();
        return fmt::format("{:%Y-%m-%d}", now);
    }
}

#endif //CLASHBOT_STRINGUTILS_H
