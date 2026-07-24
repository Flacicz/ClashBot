#ifndef ACTIVITYTRACKING_SYNCRESULT_H
#define ACTIVITYTRACKING_SYNCRESULT_H
#include <string>
#include <variant>

#include "events/ApplicationEvents.h"

struct SyncResult
{
    std::string serviceName;
    std::string clanTag;
    bool successFlag = false;
    std::string errorMsg;

    std::vector<ApplicationEvent> events;

    static SyncResult error(std::string service, std::string tag, std::string msg);
};

#endif //ACTIVITYTRACKING_SYNCRESULT_H
