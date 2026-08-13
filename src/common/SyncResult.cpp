#include "common/SyncResult.h"

#include <utility>

SyncResult SyncResult::success(std::string service,
                               std::string tag,
                               std::vector<ApplicationEvent> events)
{
    SyncResult result;

    result.serviceName = std::move(service);
    result.clanTag = std::move(tag);
    result.successFlag = true;
    result.events = std::move(events);

    return result;
}

SyncResult SyncResult::error(std::string service, std::string tag, std::string msg)
{
    SyncResult result;

    result.serviceName = std::move(service);
    result.clanTag = std::move(tag);
    result.successFlag = false;
    result.errorMsg = std::move(msg);

    return result;
}
