#include "common/SyncResult.h"

SyncResult SyncResult::error(std::string service, std::string tag, std::string msg)
{
    SyncResult result;

    result.serviceName = std::move(service);
    result.clanTag = std::move(tag);
    result.successFlag = false;
    result.errorMsg = std::move(msg);

    return result;
}
