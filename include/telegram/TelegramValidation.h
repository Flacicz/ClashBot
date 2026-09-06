#pragma once

#include <optional>
#include <string_view>

#include "models/common/CommonModels.h"

namespace telegram
{
    [[nodiscard]] std::optional<int>
    parseTownHall(std::string_view value);

    [[nodiscard]] std::optional<Audience>
    resolveAudience(std::string_view chatType);
}
