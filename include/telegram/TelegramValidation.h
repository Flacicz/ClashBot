#pragma once

#include <optional>
#include <string_view>

namespace telegram
{
    [[nodiscard]] std::optional<int>
    parseTownHall(std::string_view value);
}
