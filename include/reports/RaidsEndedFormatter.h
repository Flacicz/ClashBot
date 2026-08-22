#ifndef CLASHBOT_RAIDREPORTFORMATTER_H
#define CLASHBOT_RAIDREPORTFORMATTER_H

#include <string>

#include "database/repos/ClansRepo.h"
#include "database/repos/RaidRepo.h"
#include "events/ApplicationEvents.h"
#include "models/raid/RaidModels.h"

class RaidsEndedFormatter
{
    ClansRepo& clansRepo;
    RaidRepo& raidRepo;

public:
    explicit RaidsEndedFormatter(ClansRepo& clansRepo, RaidRepo& raidRepo);

    [[nodiscard]] std::string format(const RaidsEndedEvent& event) const;
    static std::string buildReport(const RaidReportData& reportData);
};

#endif //CLASHBOT_RAIDREPORTFORMATTER_H
