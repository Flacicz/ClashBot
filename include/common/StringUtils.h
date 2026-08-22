#ifndef CLASHBOT_STRINGUTILS_H
#define CLASHBOT_STRINGUTILS_H
#include <string>
#include <string_view>

namespace utils
{
    std::string transformTag(std::string_view tag);

    std::string getCurrentDateString();

    std::string escapeHTML(std::string_view str);
}

#endif //CLASHBOT_STRINGUTILS_H
