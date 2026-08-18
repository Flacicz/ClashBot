#pragma once

#include <span>
#include <optional>
#include <vector>

#include "models/Models.h"

namespace clanwar_analytics
{
    [[nodiscard]] std::optional<ClanwarHistoricalAverages> calculateHistoricalAverages(
        std::span<const ClanwarWarStats> previousWars);

    [[nodiscard]] ClanwarComparisonData buildComparisonData(
        const ClanwarWarStats& currentWar,
        const std::vector<ClanwarWarStats>& previousWars);

    [[nodiscard]] ClanwarPerformanceComparison compareWithHistoricalAverage(
        const ClanwarWarStats& currentWar,
        const ClanwarHistoricalAverages& historicalAverages);
}
