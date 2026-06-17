#ifndef ACTIVITYTRACKING_RAIDREPORTFORMATTER_H
#define ACTIVITYTRACKING_RAIDREPORTFORMATTER_H
#include <string>

#include "IReportFormatter.h"
#include "models/models.h"


class RaidReportFormatter : public IReportFormatter
{
public:
    std::string format(const SyncResult& result) override;
    [[nodiscard]] bool shouldNotify(const SyncResult& result, const Database& db, long long chatId) const override;
    void onNotificationSent(const SyncResult& result, const Database& db, long long chatId) const override;
};

#endif //ACTIVITYTRACKING_RAIDREPORTFORMATTER_H
