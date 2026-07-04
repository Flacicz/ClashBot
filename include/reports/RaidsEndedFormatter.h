#ifndef ACTIVITYTRACKING_RAIDREPORTFORMATTER_H
#define ACTIVITYTRACKING_RAIDREPORTFORMATTER_H
#include <string>

#include "database/repos/clansRepo.h"
#include "database/repos/raidRepo.h"
#include "events/DomainEvents.h"
#include "models/models.h"

class RaidsEndedFormatter
{
    ClansRepo& clansRepo;
    RaidRepo& raidRepo;

public:
    explicit RaidsEndedFormatter(ClansRepo& clansRepo, RaidRepo& raidRepo);

    [[nodiscard]] std::string format(const RaidsEndedEvent& event) const;
    static std::string buildReport(const RaidReportData& reportData);
};

#endif //ACTIVITYTRACKING_RAIDREPORTFORMATTER_H
