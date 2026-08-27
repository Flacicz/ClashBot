#include "common/StringUtils.h"

#include <chrono>

#include <fmt/chrono.h>

namespace utils
{
    std::string transformTag(const std::string_view tag)
    {
        if (tag.empty()) return "";
        return tag.front() == '#' ? "%23" + std::string(tag.substr(1)) : "%23" + std::string(tag);
    }

    std::string getCurrentDateString()
    {
        auto now = std::chrono::system_clock::now();
        return fmt::format("{:%Y-%m-%d}", now);
    }

    std::string escapeHTML(const std::string_view str)
    {
        constexpr std::string_view leftAngle = "\xE3\x80\x8A"; // 《
        constexpr std::string_view rightAngle = "\xE3\x80\x8B"; // 》

        std::string result;
        result.reserve(str.size());

        for (std::size_t i = 0; i < str.size();)
        {
            if (str.compare(i, leftAngle.size(), leftAngle) == 0)
            {
                result += "&lt;";
                i += leftAngle.size();
            }
            else if (str.compare(i, rightAngle.size(), rightAngle) == 0)
            {
                result += "&gt;";
                i += rightAngle.size();
            }
            else
            {
                switch (str[i])
                {
                case '&':
                    result += "&amp;";
                    break;

                case '<':
                    result += "&lt;";
                    break;

                case '>':
                    result += "&gt;";
                    break;

                default:
                    result += str[i];
                    break;
                }

                ++i;
            }
        }

        return result;
    }

    std::string removeTrailingNewlines(std::string str)
    {
        while (!str.empty() && str.back() == '\n')
        {
            str.pop_back();
        }

        return str;
    }
}
