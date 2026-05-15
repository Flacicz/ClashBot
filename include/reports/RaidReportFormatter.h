#ifndef ACTIVITYTRACKING_RAIDREPORTFORMATTER_H
#define ACTIVITYTRACKING_RAIDREPORTFORMATTER_H
#include <string>

#include "IReportFormatter.h"
#include "models/models.h"


class RaidReportFormatter : public IReportFormatter
{
public:
    std::string format(const SyncResult& result) override;
};

#endif //ACTIVITYTRACKING_RAIDREPORTFORMATTER_H
