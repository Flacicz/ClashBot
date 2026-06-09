#ifndef ACTIVITYTRACKING_CLANINFOREPORTFORMATTER_H
#define ACTIVITYTRACKING_CLANINFOREPORTFORMATTER_H
#include "IReportFormatter.h"

class Database;

class ClanInfoReportFormatter : public IReportFormatter
{
public:
    std::string format(const SyncResult& result) override;
    [[nodiscard]] bool shouldNotify(const SyncResult& result, const Database& db) const override;

    void onNotificationSent(const SyncResult& result, const Database& db) const override;
};

#endif //ACTIVITYTRACKING_CLANINFOREPORTFORMATTER_H
