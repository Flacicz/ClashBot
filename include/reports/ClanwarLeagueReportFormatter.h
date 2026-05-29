#ifndef ACTIVITYTRACKING_CLANWARLEAGUEREPORTFORMATTER_H
#define ACTIVITYTRACKING_CLANWARLEAGUEREPORTFORMATTER_H

#include "IReportFormatter.h"

class ClanwarLeagueReportFormatter : public IReportFormatter
{
public:
    std::string format(const SyncResult& result) override;
    [[nodiscard]] bool shouldNotify(const SyncResult& result) const override;
};

#endif //ACTIVITYTRACKING_CLANWARLEAGUEREPORTFORMATTER_H
