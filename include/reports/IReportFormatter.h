#ifndef ACTIVITYTRACKING_IREPORTFORMATTER_H
#define ACTIVITYTRACKING_IREPORTFORMATTER_H
#include "common/SyncResult.h"


class IReportFormatter {
public:
    virtual ~IReportFormatter() = default;

    [[nodiscard]] virtual bool shouldNotify(const SyncResult& result) const = 0;
    [[nodiscard]] virtual std::string format(const SyncResult& result) = 0;
};



#endif //ACTIVITYTRACKING_IREPORTFORMATTER_H
