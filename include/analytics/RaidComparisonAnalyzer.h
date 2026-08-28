#pragma once

#include <optional>
#include <span>
#include <vector>

#include "models/raid/RaidModels.h"

namespace raids_analytics
{
    [[nodiscard]] std::optional<RaidHistoricalAverages> calculateHistoricalAverages(
        std::span<const RaidComparisonStats> previousRaids);

    [[nodiscard]] RaidComparisonData buildComparisonData(
        const RaidComparisonStats& currentRaid,
        const std::vector<RaidComparisonStats>& previousRaids);

    [[nodiscard]] RaidPerformanceComparison compareWithHistoricalAverage(
        const RaidComparisonStats& currentRaid,
        const RaidHistoricalAverages& historicalAverages);
}
