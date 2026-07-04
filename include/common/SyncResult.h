#ifndef ACTIVITYTRACKING_SYNCRESULT_H
#define ACTIVITYTRACKING_SYNCRESULT_H
#include <string>
#include <variant>

#include "events/DomainEvents.h"
#include "models/models.h"

struct SyncResult
{
    std::string serviceName;
    std::string clanTag;
    bool successFlag = false;
    std::string errorMsg;

    std::vector<DomainEvent> events;

    static SyncResult error(std::string service, std::string tag, std::string msg);
};

#endif //ACTIVITYTRACKING_SYNCRESULT_H
