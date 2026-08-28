#ifndef CLASHBOT_RAIDSCOMPARISONFORMATTER_H
#define CLASHBOT_RAIDSCOMPARISONFORMATTER_H

#include <string>

#include "database/repos/ClansRepo.h"
#include "database/repos/RaidRepo.h"
#include "events/ApplicationEvents.h"
#include "models/raid/RaidModels.h"

class RaidsComparisonFormatter
{
    ClansRepo& clansRepo;
    RaidRepo& raidRepo;

public:
    static constexpr auto EventType = "raids_comparison";

    explicit RaidsComparisonFormatter(ClansRepo& clansRepo, RaidRepo& raidRepo);

    [[nodiscard]] std::string format(const RaidsEndedEvent& event) const;
    [[nodiscard]] static std::string buildReport(const RaidComparisonData& reportData);
};

#endif // CLASHBOT_RAIDSCOMPARISONFORMATTER_H
