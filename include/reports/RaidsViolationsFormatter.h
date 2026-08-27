#ifndef CLASHBOT_RAIDSVIOLATIONSFORMATTER_H
#define CLASHBOT_RAIDSVIOLATIONSFORMATTER_H

#include <string>
#include <string_view>
#include <vector>

#include "database/repos/RaidRepo.h"
#include "events/ApplicationEvents.h"
#include "models/raid/RaidModels.h"

class RaidsViolationsFormatter
{
    RaidRepo& raidRepo;

public:
    static constexpr auto EventType = "raids_violations";

    explicit RaidsViolationsFormatter(RaidRepo& raidRepo);

    [[nodiscard]] std::string format(const RaidsEndedEvent& event) const;
    [[nodiscard]] static std::string buildReport(
        std::string_view clanTag,
        const std::vector<RaidSlacker>& slackers);
};

#endif //CLASHBOT_RAIDSVIOLATIONSFORMATTER_H
