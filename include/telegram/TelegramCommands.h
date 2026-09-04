#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace telegram
{
    struct Command
    {
        std::string name;
        std::vector<std::string> arguments;
    };

    [[nodiscard]] std::optional<Command>
    parseCommand(std::string_view text);

    // Returns a canonical tag in the form #XXXXXXXX.
    [[nodiscard]] std::optional<std::string>
    parseClanTag(std::string_view value);
}
