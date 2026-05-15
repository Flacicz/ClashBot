//
// Created by zuevm on 13.05.2026.
//

#ifndef ACTIVITYTRACKING_CLANWARREPORTFORMATTER_H
#define ACTIVITYTRACKING_CLANWARREPORTFORMATTER_H
#include "IReportFormatter.h"

class ClanwarReportFormatter : public IReportFormatter
{
public:
    std::string format(const SyncResult& result) override;
};

#endif //ACTIVITYTRACKING_CLANWARREPORTFORMATTER_H
