#pragma once

#include <string>

#include "database/repos/ClanwarRepo.h"
#include "events/ApplicationEvents.h"

class ClanwarComparisonFormatter
{
    ClanwarRepo& clanwarRepo;

public:
    static constexpr auto EventType = "war_comparison";

    explicit ClanwarComparisonFormatter(ClanwarRepo& repo);

    [[nodiscard]] std::string format(const WarEndedEvent& event) const;
    [[nodiscard]] static std::string buildReport(
        const ClanwarComparisonData& reportData);
};
