#ifndef ACTIVITYTRACKING_ISERVICE_H
#define ACTIVITYTRACKING_ISERVICE_H
#include "common/SyncResult.h"


class ISyncService {
public:
    virtual SyncResult updateData(std::string_view tag) = 0;
    [[nodiscard]] virtual std::string getServiceName() const = 0;

    virtual ~ISyncService() = default;
};

#endif //ACTIVITYTRACKING_ISERVICE_H
